import { InlineKeyboard } from "grammy";
import type { Bot } from "grammy";
import { PrismaClient, CreditSource } from "@prisma/client";
import { grantPurchasedCredits, getCreditBalance } from "./credits.js";
import { adminCreditKeyboard, adminMenu, adminUserKeyboard, adminBannedUserKeyboard } from "./keyboards.js";

const ADMIN_TELEGRAM_IDS = new Set((process.env.ADMIN_TELEGRAM_IDS || "").split(",").map((v) => v.trim()).filter(Boolean));
const pendingUserActions = new Map<number, { type: "grant" | "remove" | "search" | "ban"; amount?: number }>();
const selectedUsers = new Map<number, string>();

export function isAdmin(telegramId?: number | bigint) { return telegramId !== undefined && ADMIN_TELEGRAM_IDS.has(String(telegramId)); }

function formatUser(user: any, balance: any) {
  const status = user.isBanned ? `🚫 BANNED${user.banReason ? ` — ${user.banReason}` : ""}` : "🟢 ACTIVE";
  return `👤 *USER*\n\n🆔 Telegram ID: \`${user.telegramId}\`\n👤 Username: ${user.username ? "@" + user.username : "—"}\n🌐 Language: ${user.language}\n📅 Registered: ${user.createdAt.toISOString()}\n📌 Status: ${status}${user.bannedAt ? `\n🚫 Banned at: ${user.bannedAt.toISOString()}` : ""}\n\n💳 *BALANCE*\n🎁 Free: ${balance.free}\n👥 Referral: ${balance.referral}\n💳 Purchased: ${balance.purchased}\n🎬 Total: ${balance.total}`;
}

async function userByTelegramId(prisma: PrismaClient, value: string) { if (!/^\d+$/.test(value)) return null; return prisma.user.findUnique({ where: { telegramId: BigInt(value) } }); }

async function renderUser(ctx: any, prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return ctx.reply("❌ Қолданушы табылмады.");
  const balance = await getCreditBalance(prisma, user.id);
  selectedUsers.set(ctx.from.id, user.id);
  return ctx.reply(formatUser(user, balance), { parse_mode: "Markdown", reply_markup: user.isBanned ? adminBannedUserKeyboard() : adminUserKeyboard() });
}

export function registerAdminPanel(bot: Bot, prisma: PrismaClient) {
  bot.command("admin", async ctx => { if (!isAdmin(ctx.from?.id)) return; await ctx.reply("🛠 *TIKTOK4K ADMIN PANEL*\n\nБасқару бөлімін таңдаңыз:", { parse_mode: "Markdown", reply_markup: adminMenu() }); });

  bot.callbackQuery("admin:stats", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    const [users, completed, failed, running, purchases, credits] = await Promise.all([prisma.user.count(), prisma.usageRecord.count({where:{status:"COMPLETED"}}), prisma.usageRecord.count({where:{status:"FAILED"}}), prisma.usageRecord.count({where:{status:"RUNNING"}}), prisma.purchase.count({where:{status:"PAID"}}), prisma.creditLot.aggregate({_sum:{quantity:true,remaining:true}})]);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`📊 *STATISTICS*\n\n👥 Users: *${users}*\n🎬 Completed: *${completed}*\n❌ Failed: *${failed}*\n⏳ Running: *${running}*\n\n💳 Paid purchases: *${purchases}*\n🎁 Total credits: *${credits._sum.quantity || 0}*\n📦 Remaining credits: *${credits._sum.remaining || 0}*`, {parse_mode:"Markdown",reply_markup:adminMenu()});
  });

  bot.callbackQuery("admin:users", async ctx => { if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({text:"Access denied"}); await ctx.answerCallbackQuery(); await ctx.editMessageText("👥 *USER MANAGEMENT*\n\nTelegram ID арқылы қолданушыны іздеңіз.", {parse_mode:"Markdown",reply_markup:adminUserKeyboard()}); });
  bot.callbackQuery("admin:user:search", async ctx => { if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({text:"Access denied"}); pendingUserActions.set(ctx.from!.id,{type:"search"}); await ctx.answerCallbackQuery(); await ctx.reply("🔎 Telegram ID жіберіңіз:"); });

  bot.callbackQuery("admin:user:history", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({text:"Access denied"});
    const userId=selectedUsers.get(ctx.from!.id); if(!userId)return ctx.answerCallbackQuery({text:"Алдымен user таңдаңыз"});
    const rows=await prisma.usageRecord.findMany({where:{userId},orderBy:{createdAt:"desc"},take:10,select:{id:true,status:true,creditLotId:true,createdAt:true,completedAt:true}});
    await ctx.answerCallbackQuery();
    const text=rows.length?rows.map((r,i)=>`${i+1}. ${r.status} | ${r.createdAt.toISOString()} | ${r.id.slice(0,8)}`).join("\n"):"Тарих бос.";
    await ctx.reply(`🎬 *USAGE HISTORY — соңғы 10*\n\n${text}`,{parse_mode:"Markdown",reply_markup:adminUserKeyboard()});
  });

  bot.callbackQuery("admin:user:ban", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    const userId = selectedUsers.get(ctx.from!.id); if (!userId) return ctx.answerCallbackQuery({ text: "Алдымен user таңдаңыз" });
    pendingUserActions.set(ctx.from!.id, { type: "ban" });
    await ctx.answerCallbackQuery();
    await ctx.reply("🚫 Ban себебін жазыңыз. Себеп қажет болмаса `—` жіберіңіз:");
  });

  bot.callbackQuery("admin:user:unban", async ctx => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: "Access denied" });
    const userId = selectedUsers.get(ctx.from!.id); if (!userId) return ctx.answerCallbackQuery({ text: "Алдымен user таңдаңыз" });
    await prisma.user.update({ where: { id: userId }, data: { isBanned: false, banReason: null, bannedAt: null } });
    await ctx.answerCallbackQuery({ text: "Unbanned" });
    await renderUser(ctx, prisma, userId);
  });

  bot.callbackQuery("admin:credits", async ctx => { if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({text:"Access denied"}); await ctx.answerCallbackQuery(); await ctx.editMessageText("💳 *CREDIT MANAGEMENT*\n\nПакет таңдаңыз, кейін Telegram ID жіберіңіз.", {parse_mode:"Markdown",reply_markup:adminCreditKeyboard()}); });
  for(const amount of [5,10,15] as const) bot.callbackQuery(`admin:grant:${amount}`,async ctx=>{if(!isAdmin(ctx.from?.id))return ctx.answerCallbackQuery({text:"Access denied"});pendingUserActions.set(ctx.from!.id,{type:"grant",amount});await ctx.answerCallbackQuery({text:`${amount} видео таңдалды`});await ctx.reply(`➕ ${amount} видео қосу.\nTelegram ID жіберіңіз:`);});

  bot.callbackQuery("admin:user:remove", async ctx => { if(!isAdmin(ctx.from?.id))return ctx.answerCallbackQuery({text:"Access denied"}); const userId=selectedUsers.get(ctx.from!.id); if(!userId)return ctx.answerCallbackQuery({text:"Алдымен user таңдаңыз"}); pendingUserActions.set(ctx.from!.id,{type:"remove",amount:1}); await ctx.answerCallbackQuery(); await ctx.reply("➖ 1 purchased credit алып тастау үшін растаңыз: /remove1"); });

  bot.on("message:text", async ctx => {
    if(!isAdmin(ctx.from?.id))return;
    const text=ctx.message.text.trim(); const pending=pendingUserActions.get(ctx.from!.id);
    if(pending?.type==="search"&&/^\d+$/.test(text)){pendingUserActions.delete(ctx.from!.id);const user=await userByTelegramId(prisma,text);if(!user)return ctx.reply("❌ Қолданушы табылмады.");return renderUser(ctx,prisma,user.id);}
    if(pending?.type==="grant"&&/^\d+$/.test(text)){const user=await userByTelegramId(prisma,text);if(!user)return ctx.reply("❌ Қолданушы табылмады.");const result=await grantPurchasedCredits(prisma,user.id,pending.amount as 5|10|15);pendingUserActions.delete(ctx.from!.id);return ctx.reply(`✅ ${pending.amount} credit қосылды.\nUser: ${text}\nPurchase: ${result.purchase.id}`);}
    if(pending?.type==="ban"){const userId=selectedUsers.get(ctx.from!.id);pendingUserActions.delete(ctx.from!.id);if(!userId)return ctx.reply("❌ User таңдалмаған.");const reason=text==="—"?null:text;await prisma.user.update({where:{id:userId},data:{isBanned:true,banReason:reason,bannedAt:new Date()}});return renderUser(ctx,prisma,userId);}
    if(text.startsWith("/user ")){const user=await userByTelegramId(prisma,text.slice(6).trim());if(!user)return ctx.reply("❌ Қолданушы табылмады.");return renderUser(ctx,prisma,user.id);}
    if(text==="/remove1"&&pending?.type==="remove"){const userId=selectedUsers.get(ctx.from!.id);pendingUserActions.delete(ctx.from!.id);if(!userId)return ctx.reply("❌ User таңдалмаған.");const lot=await prisma.creditLot.findFirst({where:{userId,source:CreditSource.PURCHASE,remaining:{gt:0}},orderBy:{createdAt:"desc"}});if(!lot)return ctx.reply("❌ Purchased credit жоқ.");await prisma.creditLot.update({where:{id:lot.id},data:{remaining:{decrement:1}}});return ctx.reply("✅ 1 purchased credit алынды.");}
  });

  bot.callbackQuery("admin:purchases",async ctx=>{if(!isAdmin(ctx.from?.id))return ctx.answerCallbackQuery({text:"Access denied"});const[pending,paid,cancelled]=await Promise.all([prisma.purchase.count({where:{status:"PENDING"}}),prisma.purchase.count({where:{status:"PAID"}}),prisma.purchase.count({where:{status:"CANCELLED"}})]);await ctx.answerCallbackQuery();await ctx.editMessageText(`📦 *PURCHASES*\n\n⏳ Pending: ${pending}\n✅ Paid: ${paid}\n❌ Cancelled: ${cancelled}`,{parse_mode:"Markdown",reply_markup:adminMenu()});});
  bot.callbackQuery("admin:videos",async ctx=>{if(!isAdmin(ctx.from?.id))return ctx.answerCallbackQuery({text:"Access denied"});const[total,completed,failed]=await Promise.all([prisma.usageRecord.count(),prisma.usageRecord.count({where:{status:"COMPLETED"}}),prisma.usageRecord.count({where:{status:"FAILED"}})]);await ctx.answerCallbackQuery();await ctx.editMessageText(`🎬 *VIDEO STATISTICS*\n\nTotal: ${total}\n✅ Completed: ${completed}\n❌ Failed: ${failed}`,{parse_mode:"Markdown",reply_markup:adminMenu()});});
  bot.callbackQuery("admin:referrals",async ctx=>{if(!isAdmin(ctx.from?.id))return ctx.answerCallbackQuery({text:"Access denied"});const[total,granted]=await Promise.all([prisma.referral.count(),prisma.referral.count({where:{bonusGranted:true}})]);await ctx.answerCallbackQuery();await ctx.editMessageText(`👥 *REFERRALS*\n\nTotal referrals: ${total}\n🎁 Bonuses granted: ${granted}`,{parse_mode:"Markdown",reply_markup:adminMenu()});});
  bot.callbackQuery("admin:broadcast",async ctx=>{if(!isAdmin(ctx.from?.id))return ctx.answerCallbackQuery({text:"Access denied"});await ctx.answerCallbackQuery();await ctx.reply("📢 Broadcast — confirmation + rate limit келесі блокта қосылады.");});
  bot.callbackQuery("admin:back",async ctx=>{if(!isAdmin(ctx.from?.id))return ctx.answerCallbackQuery({text:"Access denied"});await ctx.answerCallbackQuery();await ctx.editMessageText("🛠 *TIKTOK4K ADMIN PANEL*\n\nБасқару бөлімін таңдаңыз:",{parse_mode:"Markdown",reply_markup:adminMenu()});});
  bot.callbackQuery("admin:close",async ctx=>{if(!isAdmin(ctx.from?.id))return ctx.answerCallbackQuery({text:"Access denied"});await ctx.answerCallbackQuery();await ctx.deleteMessage().catch(()=>undefined);});
}
