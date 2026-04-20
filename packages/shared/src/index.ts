export type { Role, ScopeLevel } from './roles';
export { ROLES, SCOPE_LEVELS } from './roles';
export type { Capability } from './capabilities';
export { CAPABILITIES_BY_ROLE, capabilitiesFor, can } from './capabilities';
export type { BaseUser, AuthUser } from './user';
export type { Gender, GraduationReason, Student } from './student';
export type {
  EventKind,
  Event,
  AttendanceMark,
  AttendanceSession,
  AttendanceSessionWithMarks,
} from './event';
export type { AchievementType, Achievement, AchievementWithStudent } from './achievement';
export type { GeoLevel, DashboardMetric } from './dashboard';
export {
  GEO_LEVELS,
  DASHBOARD_METRICS,
  isGeoLevel,
  isDashboardMetric,
} from './dashboard';
export { isIndianPhone, isIsoDate, isClockTime } from './validation';
