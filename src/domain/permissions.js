
export const ROLES = {
  owner:    { label: "مالك المكتب", color: "#BF9000", textOn: "#1F1F1F" },
  manager:  { label: "مدير مشاريع", color: "#1E7B45", textOn: "#FFFFFF" },
  engineer: { label: "مهندس",       color: "#2E5395", textOn: "#FFFFFF" },
  pending:  { label: "بانتظار الموافقة", color: "#B45309", textOn: "#FFFFFF" },
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
