export const hasLatinText = (text) => /\p{Script=Latin}/u.test(text);
export const isLatinOnlyText = (text) => hasLatinText(text) && !/\p{Script=Han}/u.test(text);
export const CHINESE_TEXT_MESSAGE = "Please write Chinese characters, or enter the Chinese text you intended, before requesting grammar feedback.";
