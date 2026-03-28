"use strict";

const { getTime } = global.utils;

module.exports = {
  config: {
    name: "welcome",
    version: "3.0.0",
    author: "VincentSensei",
    countDown: 0,
    role: 0,
    description: "Welcome new members with a premium contact card",
    category: "events"
  },

  onStart: async function ({ threadsData, event, usersData, api }) {
    if (event.logMessageType != "log:subscribe") return;

    try {
      const { threadID } = event;
      const threadsInfo = await threadsData.get(threadID);
      if (!threadsInfo.settings.sendWelcomeMessage) return;

      const addedList = event.logMessageData.addedParticipants || [];
      const data = threadsInfo.data || {};
      const welcomeTemplate = data.welcomeMessage || "Hello {userName}, Welcome to {threadName}!";
      const threadName = threadsInfo.threadName || "this group";
      const hours = getTime("HH");

      const session = hours <= 10 ? "Morning" : 
                      hours <= 12 ? "Noon" : 
                      hours <= 18 ? "Afternoon" : "Evening";

      for (const participant of addedList) {
        const uid = participant.userFbId;
        const userName = participant.fullName || (await usersData.getName(uid));
        
        const msg = welcomeTemplate
          .replace(/\{userName\}/g, userName)
          .replace(/\{userNameTag\}/g, userName)
          .replace(/\{threadName\}|\{boxName\}/g, threadName)
          .replace(/\{time\}/g, hours)
          .replace(/\{session\}/g, session);

        if (typeof api.shareContact === "function") {
          console.log(`[WELCOME] Sending contact card for ${uid} in ${threadID}`);
          api.shareContact(msg, uid, threadID);
        } else {
          api.sendMessage({ body: msg, mentions: [{ tag: userName, id: uid }] }, threadID);
        }
      }
    } catch (error) {
      console.error("[WELCOME] Error:", error.message);
    }
  }
};
