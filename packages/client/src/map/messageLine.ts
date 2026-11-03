// The original's message line in the status bar (Tab): typed there, sent with Enter (cheat codes
// in single player), Escape drops it.

export class MessageLine {
  /** What has been typed so far, or null while the line is closed. */
  text: string | null = null;
  private readonly show: (status: string) => void;
  private readonly send: (text: string) => void;

  constructor(show: (status: string) => void, send: (text: string) => void) {
    this.show = show;
    this.send = send;
  }

  get open() {
    return this.text !== null;
  }

  start() {
    this.text = "";
    this.show("Message: _");
  }

  /** A key while the line is open (all of them go to it). */
  key(key: string) {
    if (this.text === null) return;
    if (key === "Escape") this.text = null;
    else if (key === "Enter") {
      const text = this.text.trim();
      this.text = null;
      if (text) this.send(text);
    } else if (key === "Backspace") this.text = this.text.slice(0, -1);
    else if (key.length === 1 && this.text.length < 60) this.text += key;
    this.show(this.text === null ? "" : `Message: ${this.text}_`);
  }
}
