
export const ROLES = {
  owner:    { label: "مالك المكتب", color: "#B08A3E", textOn: "#1C1B19" },
  manager:  { label: "مدير مشاريع", color: "#4A6152", textOn: "#FFFFFF" },
  engineer: { label: "مهندس",       color: "#6B5B7B", textOn: "#FFFFFF" },
  pending:  { label: "بانتظار الموافقة", color: "#8C8880", textOn: "#FFFFFF" },
};
export const ASSIGNABLE_ROLES = ["engineer", "manager", "owner"];

export const PERMISSIONS = {
  viewAllClients:   ["owner", "manager"],
  editUnitPrice:    ["owner", "manager"],
  viewCostBasis:    ["owner", "manager"],
  advanceToSigned:  ["owner", "manager"],
  deleteClient:     ["owner"],
  manageTeam:       ["owner"],
  editClientData:   ["owner", "manager", "engineer"],
  logSiteVisit:     ["owner", "manager", "engineer"],
};

export function can(member, action) {
  const allowed = PERMISSIONS[action];
  if (!allowed) return false;
  return !!member && allowed.includes(member.role);
}

export function roleLabel(role) {
  return (ROLES[role] || ROLES.engineer).label;
}
