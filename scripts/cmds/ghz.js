const WebSocket = require('ws');

const activeSessions = new Map();
const lastSentCache = new Map();
const favoriteMap = new Map();
const previousStockCache = new Map();

const ZENITH_WS_URL = "wss://api.nthanhtai.xyz/api/stock";

let ws = null;
let wsReconnectTimer = null;
let pollTimer = null;
let isWsConnected = false;
let hasReceivedFirstData = false;

function formatValue(val) {
	if (val >= 1_000_000) return `×${(val / 1_000_000).toFixed(1)}M`;
	if (val >= 1_000) return `×${(val / 1_000).toFixed(1)}K`;
	return `×${val}`;
}

function formatDateTime(isoString) {
	if (!isoString) return new Date().toLocaleString("en-US", { timeZone: "Asia/Manila", hour12: true });
	try {
		const date = new Date(isoString);
		return date.toLocaleString("en-US", { timeZone: "Asia/Manila", hour12: true, month: "numeric", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
	} catch (e) {
		return new Date().toLocaleString("en-US", { timeZone: "Asia/Manila", hour12: true });
	}
}

function cleanText(text) {
	return text ? text.trim().toLowerCase() : "";
}

function formatItems(items) {
	if (!Array.isArray(items)) return "";
	return items
		.filter(i => i && i.quantity > 0)
		.map(i => `│  ${i.display_name || i.name || "Unknown"}: ${formatValue(i.quantity)}`)
		.join("\n");
}

function getStockKey(seeds, gear) {
	const allItems = [...seeds, ...gear].filter(i => i && i.quantity > 0);
	return JSON.stringify(allItems.map(i => ({ name: cleanText(i.display_name || i.name), quantity: i.quantity })).sort((a, b) => a.name.localeCompare(b.name)));
}

function processMarketData(rawPayload) {
	if (!rawPayload || !rawPayload.data) return;

	let payload;
	if (rawPayload.data.seeds || rawPayload.data.gear) {
		payload = {
			seeds: rawPayload.data.seeds || [],
			gear: rawPayload.data.gear || [],
			weather: null,
			lastUpdated: rawPayload.data.reportedAt ? new Date(rawPayload.data.reportedAt).toISOString() : null
		};
	} else {
		payload = rawPayload;
	}

	const seeds = Array.isArray(payload.seeds) ? payload.seeds : [];
	const gear = Array.isArray(payload.gear) ? payload.gear : [];

	if (activeSessions.size === 0) return;

	const currentStockKey = getStockKey(seeds, gear);
	const previousStockKey = previousStockCache.get("global");

	if (!hasReceivedFirstData) {
		hasReceivedFirstData = true;
		previousStockCache.set("global", currentStockKey);
		console.log("[GHZ] First data received");
	} else if (previousStockKey && previousStockKey === currentStockKey) {
		console.log("[GHZ] No stock change, skipping");
		return;
	}

	previousStockCache.set("global", currentStockKey);

	for (const [threadId, session] of activeSessions.entries()) {
		const favList = favoriteMap.get(threadId) || [];
		let sections = [];
		let matchCount = 0;

		function checkItems(label, items) {
			const available = items.filter(i => i && i.quantity > 0);
			if (available.length === 0) return false;
			const matched = favList.length > 0
				? available.filter(i => favList.includes(cleanText(i.display_name || i.name)))
				: available;
			if (favList.length > 0 && matched.length === 0) return false;
			matchCount += matched.length;
			sections.push(`${label}\n${formatItems(matched)}`);
			return true;
		}

		checkItems("🌱  𝐒𝐄𝐄𝐃𝐒  🧱", seeds);
		checkItems("⚙️  𝐆𝐄𝐀𝐑  🛠️", gear);

		if (favList.length > 0 && matchCount === 0) continue;
		if (sections.length === 0) continue;

		const updatedAt = formatDateTime(payload.lastUpdated);
		const title = favList.length > 0 ? `❤️ ${matchCount} Favorites Found! ❤️` : "🌾 Stock Market Update 🌾";

		const messageContent = `${title}\n\n${sections.join("\n")}\n\nUpdated: ${updatedAt}`;

		const messageKey = JSON.stringify({ title, sections, updatedAt });
		if (lastSentCache.get(threadId) === messageKey) continue;
		lastSentCache.set(threadId, messageKey);

		try {
			session.api.sendMessage(messageContent, session.threadID);
			console.log(`[GHZ] Sent to ${threadId}`);
		} catch (e) {
			console.log(`[GHZ] Error: ${e.message}`);
		}
	}
}

function connectAndPoll() {
	if (ws && ws.readyState === WebSocket.OPEN) {
		// Already connected, just request new data by reconnecting
		ws.close();
		return;
	}

	console.log("[GHZ] Connecting to nthanhtai WebSocket...");

	ws = new WebSocket(ZENITH_WS_URL);

	ws.on('open', () => {
		console.log("[GHZ] ✅ Connected!");
		isWsConnected = true;
		hasReceivedFirstData = false;
	});

	ws.on('message', (data) => {
		try {
			const message = data.toString();
			if (message.startsWith('{')) {
				const json = JSON.parse(message);
				processMarketData(json);
			}
		} catch (err) {
			console.log("[GHZ] Parse error:", err.message);
		}
	});

	ws.on('close', () => {
		console.log("[GHZ] 🔌 Closed, will reconnect in 5s...");
		isWsConnected = false;
		ws = null;

		// Schedule reconnect if tracking is active
		if (activeSessions.size > 0) {
			wsReconnectTimer = setTimeout(connectAndPoll, 5000);
		}
	});

	ws.on('error', (err) => {
		console.log("[GHZ] Error:", err.message);
	});
}

function startTracking() {
	if (activeSessions.size > 0) {
		// Poll every 10 seconds to get updates
		if (!pollTimer) {
			connectAndPoll();
			pollTimer = setInterval(connectAndPoll, 10000);
			console.log("[GHZ] Started polling every 10 seconds");
		}
	} else if (activeSessions.size === 0) {
		// Stop polling when no one is tracking
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
		if (wsReconnectTimer) {
			clearTimeout(wsReconnectTimer);
			wsReconnectTimer = null;
		}
		if (ws) {
			ws.close();
			ws = null;
		}
		isWsConnected = false;
		hasReceivedFirstData = false;
		console.log("[GHZ] Stopped polling");
	}
}

module.exports = {
	config: {
		name: "ghz",
		version: "3.1",
		description: "🌱 Track live stock market via WebSocket polling",
		usage: "{pn}ghz on | {pn}ghz off | {pn}ghz fav add Item | {pn}ghz fav remove Item",
		category: "tools",
		role: 4,
		credits: "VincentSensei"
	},

	langs: {
		en: {
			alreadyTracking: "Already tracking!",
			trackingStarted: "✅ Stock Tracker Started!\nPolling every 10 seconds",
			trackingStopped: "🛑 Tracking stopped!",
			notTracking: "Use ^ghz on to start",
			favAdded: "✅ Added:",
			favRemoved: "✅ Removed:",
			favList: "Your favorites:",
			emptyFav: "(none)",
			invalidFav: "Use: ^ghz fav add Item",
			help: `📖 Commands:
^ghz on - Start
^ghz off - Stop
^ghz fav add Item - Add fav
^ghz fav remove Item - Remove fav
^ghz fav list - View favs`
		}
	},

	onStart: async ({ api, event, args, getLang }) => {
		const threadId = event.threadID;
		const subcmd = args[0]?.toLowerCase();

		if (subcmd === "fav") {
			const action = args[1]?.toLowerCase();
			const input = args.slice(2).join(" ").split("|").map(i => cleanText(i)).filter(Boolean);

			if (!action || !["add", "remove", "list"].includes(action) || (input.length === 0 && action !== "list")) {
				return api.sendMessage(getLang("invalidFav"), threadId);
			}

			const currentFav = favoriteMap.get(threadId) || [];

			if (action === "list") {
				const favDisplay = currentFav.length > 0 ? currentFav.map(item => `❤️ ${item}`).join("\n") : getLang("emptyFav");
				return api.sendMessage(`${getLang("favList")}\n${favDisplay}`, threadId);
			}

			const updated = new Set(currentFav);
			for (const name of input) {
				if (action === "add") updated.add(name);
				else updated.delete(name);
			}

			favoriteMap.set(threadId, Array.from(updated));
			const favDisplay = Array.from(updated).map(item => `❤️ ${item}`).join("\n") || getLang("emptyFav");
			const msg = action === "add" ? getLang("favAdded") : getLang("favRemoved");
			return api.sendMessage(`${msg}\n${favDisplay}`, threadId);
		}

		if (subcmd === "off") {
			if (!activeSessions.has(threadId)) {
				return api.sendMessage(getLang("notTracking"), threadId);
			}
			activeSessions.delete(threadId);
			lastSentCache.delete(threadId);
			previousStockCache.delete(threadId);
			startTracking();
			return api.sendMessage(getLang("trackingStopped"), threadId);
		}

		if (subcmd !== "on") {
			return api.sendMessage(getLang("help"), threadId);
		}

		if (activeSessions.has(threadId)) {
			return api.sendMessage(getLang("alreadyTracking"), threadId);
		}

		activeSessions.set(threadId, { api, threadID: threadId });
		await api.sendMessage(getLang("trackingStarted"), threadId);
		startTracking();
	}
};
