import { InlineKeyboard, Keyboard } from "grammy";

export function mainMenu(lang: "kk" | "ru") {
  const labels = lang === "kk"
    ? ["🎬 Видео өңдеу", "📊 Балансым", "👤 Профиль", "👥 Дос шақыру", "💳 Пакет сатып алу", "📖 Қалай қолдану керек", "⚙️ Баптаулар"]
    : ["🎬 Обработать видео", "📊 Мой баланс", "👤 Профиль", "👥 Пригласить друга", "💳 Купить пакет", "📖 Как пользоваться", "⚙️ Настройки"];
  return new Keyboard().text(labels[0]).text(labels[1]).row().text(labels[2]).text(labels[3]).row().text(labels[4]).text(labels[5]).row().text(labels[6]).resized();
}

export function settingsKeyboard(lang: "kk" | "ru") {
  return new Keyboard()
    .text(lang === "kk" ? "🇰🇿 Қазақша" : "🇰🇿 Казахский")
    .text(lang === "kk" ? "🇷🇺 Орысша" : "🇷🇺 Русский")
    .row()
    .text(lang === "kk" ? "⬅️ Артқа" : "⬅️ Назад")
    .resized();
}

export function adminMenu() {
  return new InlineKeyboard()
    .text("📊 Статистика", "admin:stats").text("👥 Қолданушылар", "admin:users").row()
    .text("💳 Видео лимиті", "admin:credits").text("📦 Сатып алулар", "admin:purchases").row()
    .text("🎬 Видео статистикасы", "admin:videos").text("👥 Достар шақыру", "admin:referrals").row()
    .text("📢 Жаппай хабарлама", "admin:broadcast").text("✖️ Жабу", "admin:close");
}

export function adminCreditKeyboard() {
  return new InlineKeyboard().text("➕ 5 видео", "admin:grant:5").text("➕ 10 видео", "admin:grant:10").row().text("➕ 15 видео", "admin:grant:15").row().text("⬅️ Артқа", "admin:back");
}

export function adminUserKeyboard() {
  return new InlineKeyboard()
    .text("🔎 Қолданушыны іздеу", "admin:user:search").row()
    .text("🎬 Видео тарихы", "admin:user:history").row()
    .text("➖ 1 видео лимитін алу", "admin:user:remove").row()
    .text("🚫 Бұғаттау", "admin:user:ban").text("⬅️ Артқа", "admin:back");
}

export function adminBannedUserKeyboard() {
  return new InlineKeyboard().text("✅ Бұғаттан шығару", "admin:user:unban").row().text("⬅️ Артқа", "admin:back");
}

export function subscribeKeyboard(checkText: string) {
  return new InlineKeyboard().url("📢 Каналға өту", "https://t.me/tiktokvideo4k").row().text(checkText, "check_subscription");
}
