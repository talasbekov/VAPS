export { BulletinPanel } from "./ui/BulletinPanel";
export { AwaitingReconStage } from "./ui/AwaitingReconStage";
export { ReconStage } from "./ui/ReconStage";
export { PlacementStage } from "./ui/PlacementStage";
export { ApprovalStage } from "./ui/ApprovalStage";
export { AcknowledgementStage } from "./ui/AcknowledgementStage";
export { ConductStage } from "./ui/ConductStage";
export { ClosedView } from "./ui/ClosedView";
// Показанный объект живёт в адресе (Plane №388): карточка и этап читают одно
// значение, и «строки без объекта» — такое же значение, как объект.
export {
  UNASSIGNED_VISIT,
  unassignedIsMeaningful,
} from "./ui/useVisitObjectScope";
