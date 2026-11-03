// Release build: no development plan or coverage pages.
export async function showComplete(_host: HTMLElement, _tab: "catalogue" | "plan" = "catalogue") {
  location.hash = "#menu";
}
