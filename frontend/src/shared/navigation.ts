export const workspaceSections = [
  { slug: "overview", label: "Overview" },
  { slug: "my-team", label: "My team" },
  { slug: "tasks", label: "Tasks" },
  { slug: "orders", label: "Orders" },
  { slug: "collections", label: "Collections" },
  { slug: "people", label: "People" },
  { slug: "staff", label: "Staff" },
  { slug: "products", label: "Products" },
  { slug: "reports", label: "Reports" },
  { slug: "settings", label: "Settings" },
] as const;

export type WorkspaceSection = (typeof workspaceSections)[number]["label"];
export type WorkspaceSlug = (typeof workspaceSections)[number]["slug"];

export function sectionFromSlug(slug: string): WorkspaceSection | null {
  return (
    workspaceSections.find((section) => section.slug === slug)?.label ?? null
  );
}

export function sectionFromPathname(pathname: string): WorkspaceSection | null {
  return sectionFromSlug(pathname.split("/").filter(Boolean)[0] ?? "");
}

export function pathForSection(label: WorkspaceSection) {
  const section = workspaceSections.find((entry) => entry.label === label);
  return `/${section?.slug ?? "overview"}`;
}
