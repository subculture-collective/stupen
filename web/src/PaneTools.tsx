export type IconName = "expand" | "restore" | "collapse" | "float" | "dock" | "run" | "submit" | "reset" | "delete" | "settings" | "search" | "list" | "close";
const paths: Record<IconName, string> = {
  expand: "M6 2H2v4M10 2h4v4M2 10v4h4M14 10v4h-4",
  restore: "M5 2h9v9M2 5h9v9H2Z",
  collapse: "m10 3-5 5 5 5", float: "M8 2h6v6M14 2 7 9M5 3H2v11h11v-3",
  dock: "M2 2h12v12H2ZM9 2v12", run: "m5 3 8 5-8 5Z",
  submit: "m3 8 3 3 7-7", reset: "M3 5a5 5 0 1 1-1 5M2 2v4h4",
  delete: "M2 4h12M6 2h4M4 4l1 10h6l1-10M7 7v4M9 7v4",
  settings: "M2 4h12M2 12h12M6 2v4M10 10v4", search: "M11 11l3 3M12 7a5 5 0 1 1-10 0 5 5 0 0 1 10 0",
  list: "M5 3h9M5 8h9M5 13h9M2 3h.1M2 8h.1M2 13h.1",
  close: "m3 3 10 10M13 3 3 13",
};
export function PaneIcon({ name }: { name: IconName }) {
  return <svg className="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d={paths[name]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
