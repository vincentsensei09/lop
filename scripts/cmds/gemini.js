const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

let fontEnabled = true;

function formatFont(text) {
  const fontMapping = {
    a: "𝖺", b: "𝖻", c: "𝖼", d: "𝖽", e: "𝖾", f: "𝖿", g: "𝗀", h: "𝗁", i: "𝗂", j: "𝗃", k: "𝗄", l: "𝗅", m: "𝗆",
    n: "𝗇", o: "𝗈", p: "𝗉", q: "𝗊", r: "𝗋", s: "𝗌", t: "𝗍", u: "𝗎", v: "𝗏", w: "𝗐", x: "𝗑", y: "𝗒", z: "𝗓",
    A: "𝖠", B: "𝖡", C: "𝖢", D: "𝖣", E: "𝖤", F: "𝖥", G: "𝖦", H: "𝖧", I: "𝖨", J: "𝖩", K: "𝖪", L: "𝖫", M: "𝖬",
    N: "𝖭", O: "𝖮", P: "𝖯", Q: "𝖰", R: "𝖱", S: "𝖲", T: "𝖳", U: "𝖴", V: "𝖵", W: "𝖶", X: "𝖷", Y: "𝖸", Z: "𝖹"
  };
  return [...text].map(char => fontEnabled && fontMapping[char] ? fontMapping[char] : char).join('');
}

async function getVoiceStream(text, lang = 'en') {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${encodeURIComponent(text.slice(0, 1500))}`;
  const response = await axios({
    method: "get",
    url: url,
    responseType: "stream"
  });
  return response.data;
}

async function handleGemini(api, event, args, message, commandName) {
  const promptText = args.join(" ").trim();
  const replyText = event.messageReply?.body || '';

  let finalPrompt = promptText;
  if (replyText) {
    finalPrompt = replyText + (promptText ? ' ' + promptText : '');
  }

  const senderID = event.senderID;
  const threadID = event.threadID;
  const messageID = event.messageID;

  const imageUrl = event.messageReply?.attachments?.[0]?.type === 'photo' 
    ? event.messageReply.attachments[0].url 
    : null;

  if (!imageUrl && !finalPrompt) {
    return api.sendMessage(formatFont("❌ Please provide a prompt or reply to an image."), threadID, messageID);
  }

  const thinkingMsg = imageUrl ? "🤖 𝗚𝗘𝗠𝗜𝗡𝗜 𝗜𝗦 𝗔𝗡𝗔𝗟𝗬𝗭𝗜𝗡𝗚..." : "🤖 𝗚𝗘𝗠𝗜𝗡𝗜 𝗜𝗦 𝗧𝗛𝗜𝗡𝗞𝗜𝗡𝗚...";

  api.sendMessage(formatFont(thinkingMsg), threadID, async (err, info) => {
    if (err) return;

    try {
      const baseUrl = "https://kryptonite-api-library.onrender.com/api/gemini-lite";
      const params = new URLSearchParams();

      if (finalPrompt) {
        params.append('prompt', finalPrompt);
      } else {
        params.append('prompt', "what is this");
      }

      params.append('uid', senderID);

      if (imageUrl) {
        params.append('imgUrl', imageUrl);
      }

      params.append('apikey', 'AIzaSyAJfs5j0GHIQHHCV1NB1zLn4VCVNKIOWw0');

      const apiUrl = `${baseUrl}?${params.toString()}`;

      const { data } = await axios.get(apiUrl);

      const responseText = data?.response || data?.description || "❌ No response received from the Gemini API.";

      api.getUserInfo(senderID, async (err, infoUser) => {
        const userName = infoUser?.[senderID]?.name || "Unknown User";

        const now = new Date();
        const phTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
        const timePH = phTime.toLocaleString('en-US', { 
          hour12: false,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });

        const replyMessage = `
🤖 𝗚𝗘𝗠𝗜𝗡𝗜 ☆
━━━━━━━━━━━━━━━━━━
${responseText}
━━━━━━━━━━━━━━━━━━
🗣 𝗔𝘀𝗸𝗲𝗱 𝗕𝘆: ${userName}
⏰ 𝗧𝗶𝗺𝗲: ${timePH}`.trim();

        // Prepare voice output
        const tempDir = path.join(__dirname, 'tmp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
        const voicePath = path.join(tempDir, `gemini_voice_${Date.now()}.mp3`);
        
        try {
          const voiceStream = await getVoiceStream(responseText);
          const writer = fs.createWriteStream(voicePath);
          voiceStream.pipe(writer);

          writer.on('finish', async () => {
            await api.editMessage({
              body: formatFont(replyMessage),
              attachment: fs.createReadStream(voicePath)
            }, info.messageID);
            
            // Cleanup voice file
            if (fs.existsSync(voicePath)) fs.unlinkSync(voicePath);

            // Add to onReply listener for conversation
            global.GoatBot.onReply.set(info.messageID, {
              commandName: commandName,
              author: senderID,
              messageID: info.messageID
            });
          });

          writer.on('error', (e) => {
            console.error("Voice write error:", e);
            api.editMessage(formatFont(replyMessage), info.messageID);
          });

        } catch (voiceError) {
          console.error("Voice generation error:", voiceError);
          api.editMessage(formatFont(replyMessage), info.messageID);
        }
      });

    } catch (error) {
      console.error("Gemini API Error:", error);

      let errorMessage = "❌ Error: ";

      if (error.response?.status === 500) {
        errorMessage += "The Gemini API server is currently experiencing issues (500 Internal Server Error). Please try again later.";
      } else if (error.response?.data?.message) {
        errorMessage += error.response.data.message;
      } else if (error.message) {
        errorMessage += error.message;
      } else {
        errorMessage += "Unknown error occurred.";
      }

      api.editMessage(formatFont(errorMessage), info.messageID);
    }
  }, messageID);
}

module.exports = {
  config: {
    name: 'gemini',
    aliases: ['gv', 'gvision', 'gemini-lite'],
    version: '1.1.0',
    author: 'Ry + VincentSensei',
    role: 0,
    shortDescription: {
      en: 'Analyze image or prompt using Gemini Vision API & Voice'
    },
    longDescription: {
      en: 'Analyze images or answer prompts using Google\'s Gemini Vision AI model. Includes voice output.'
    },
    category: 'ai',
    guide: {
      en: 'Use {p}gemini [prompt] or reply to an image with {p}gemini [question]. Non-prefix: just mention "sensei" anywhere in your message.'
    },
    cooldown: 3,
  },

  onStart: async function ({ api, event, args, message, commandName }) {
    return await handleGemini(api, event, args, message, commandName);
  },

  onChat: async function ({ api, event, message, commandName }) {
    if (!event.body) return;
    const body = event.body.toLowerCase();
    const triggers = ['sensei'];
    
    // Check if message includes any trigger word
    const trigger = triggers.find(t => body.includes(t));
    
    if (trigger) {
        // Extract prompt by removing the trigger word
        const regex = new RegExp(`\\b${trigger}\\b`, 'gi');
        const promptText = event.body.replace(regex, "").trim();
        const args = promptText ? promptText.split(/\s+/) : [];
        return await handleGemini(api, event, args, message, commandName);
    }
  },

  onReply: async function ({ api, event, message, Reply, commandName }) {
    if (event.senderID !== Reply.author) return;
    const args = event.body.split(" ");
    return await handleGemini(api, event, args, message, commandName);
  }
};

