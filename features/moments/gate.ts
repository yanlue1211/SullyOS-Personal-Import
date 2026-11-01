/** Session-only fast gate, hydrated from IndexedDB by the runtime/App. Default-off chats do no IO. */
let enabled = false;
export const momentsEnabled = () => enabled;
export const setMomentsEnabled = (value: boolean) => {
  enabled = value;
};
