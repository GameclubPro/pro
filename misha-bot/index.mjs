import "dotenv/config";
import { Bot } from "grammy";

const bot = new Bot(process.env.BOT_TOKEN);
const WEBAPP_URL = process.env.WEBAPP_URL;

bot.command("start", async (ctx) => {
  await ctx.reply("Жми кнопку и откроется Mini App:", {
    reply_markup: {
      keyboard: [[{ text: "🚀 Открыть Mini App", web_app: { url: WEBAPP_URL } }]],
      resize_keyboard: true,
    },
  });
});

bot.on("message:web_app_data", async (ctx) => {
  const data = ctx.message.web_app_data?.data;
  await ctx.reply(`Получил из Mini App: ${data}`);
});

bot.start();
