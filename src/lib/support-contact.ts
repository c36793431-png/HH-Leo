/** Who a client messages with a question. Its own module, with no server imports, so client components can read
 * it without pulling the database into the browser bundle (Fable N4). */
export const SUPPORT_HANDLE = "@Coxwell2";
export const SUPPORT_TELEGRAM_URL = `https://t.me/${SUPPORT_HANDLE.slice(1)}`;
