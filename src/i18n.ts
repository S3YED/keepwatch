/** Built-in player copy. `lang` on the element (or the page) picks one; English is the fallback. */
export const STRINGS = {
  en: {
    play: "Play the video",
    started: "Your video has started",
    unmute: "Click to turn on sound",
    resumeTitle: "You already started this video",
    resumeContinue: "Continue watching",
    resumeRestart: "Start over",
    paused: "Paused",
    replay: "Watch again",
    cta: "Book your call",
    pause: "Pause",
    resume: "Play",
    mute: "Sound off",
    soundOn: "Sound on",
    fullscreen: "Full screen",
    of: "of",
    error: "The video could not load.",
    openVimeo: "Watch it on Vimeo",
  },
  nl: {
    play: "Speel de video af",
    started: "Je video is gestart",
    unmute: "Klik om het geluid aan te zetten",
    resumeTitle: "Je bent deze video al begonnen",
    resumeContinue: "Verder kijken",
    resumeRestart: "Opnieuw beginnen",
    paused: "Gepauzeerd",
    replay: "Opnieuw kijken",
    cta: "Plan je call",
    pause: "Pauzeren",
    resume: "Afspelen",
    mute: "Geluid uit",
    soundOn: "Geluid aan",
    fullscreen: "Volledig scherm",
    of: "van",
    error: "De video kon niet laden.",
    openVimeo: "Bekijk hem op Vimeo",
  },
  ru: {
    play: "Смотреть видео",
    started: "Видео уже идёт",
    unmute: "Нажмите, чтобы включить звук",
    resumeTitle: "Вы уже начали смотреть это видео",
    resumeContinue: "Продолжить просмотр",
    resumeRestart: "Начать сначала",
    paused: "Пауза",
    replay: "Смотреть снова",
    cta: "Записаться на звонок",
    pause: "Пауза",
    resume: "Смотреть",
    mute: "Выключить звук",
    soundOn: "Включить звук",
    fullscreen: "Во весь экран",
    of: "из",
    error: "Видео не загрузилось.",
    openVimeo: "Смотреть на Vimeo",
  },
} as const;

export type Lang = keyof typeof STRINGS;
export type Strings = { [K in keyof (typeof STRINGS)["en"]]: string };

export function stringsFor(lang: string | null | undefined): { lang: Lang; t: Strings } {
  const code = (lang ?? "").slice(0, 2).toLowerCase();
  const l: Lang = code === "nl" || code === "ru" ? code : "en";
  return { lang: l, t: STRINGS[l] };
}
