export { Alert, type AlertProps, type AlertTone } from "./Alert";
// Tier 3 — the fifteen display components.
export { StatusBadge, type StatusBadgeProps, type StatusTone } from "./StatusBadge";
export { PlanBadge, type PlanBadgeProps, type PlanTier } from "./PlanBadge";
export { FilterChip, type FilterChipProps } from "./FilterChip";
// A pill that navigates, as against FilterChip, which is one you remove.
export { ChipLink, type ChipLinkProps } from "./ChipLink";
export { Tag, type TagProps } from "./Tag";
export { StatCard, type StatCardProps } from "./StatCard";
export { ProgressBar, type ProgressBarProps } from "./ProgressBar";
// Board 1m's rating marks. Squares, never stars, and never a partial mark —
// the numeral beside them carries the decimal.
export { RatingMarks, type RatingMarksProps } from "./RatingMarks";
export { StepProgress, type StepProgressProps } from "./StepProgress";
export { StackedBar, type StackedBarProps, type StackedSegment } from "./StackedBar";
export { FunnelBars, type FunnelBarsProps, type FunnelStage } from "./FunnelBars";
// Board 3l's delta, moved here by the 3a/3l amendment: two boards now render a
// movement, and a component that lives inside one board's route cannot be the
// one the other uses.
export { Delta, type DeltaProps } from "./Delta";
export { ShareBars, type ShareBarsProps, type ShareRow } from "./ShareBars";
export { Waterfall, type WaterfallProps, type WaterfallStep } from "./Waterfall";
export { ImagePlaceholder, type ImagePlaceholderProps, type PlaceholderKind } from "./ImagePlaceholder";
export { LogoTile, type LogoTileProps } from "./LogoTile";
export { CategoryMark, type CategoryMarkProps } from "./CategoryMark";
// The mono uppercase label. One of exactly two places §08 allows uppercase.
export { Eyebrow, type EyebrowProps } from "./Eyebrow";
export { MapCanvas, type MapCanvasProps, type MapPin } from "./MapCanvas";
// Board 2d's branch pin. A third map rather than a mode of the other two,
// because this one is edited: a draggable marker, a ring that follows it and a
// radius editor that changes what the map is showing.
export { BranchPinMap, type BranchPinMapProps } from "./BranchPinMap";
// Board 1c's results map. Separate from MapCanvas because it clusters, which
// means a GeoJSON source and paint layers rather than DOM markers.
export {
  ResultsMap,
  type ResultsMapProps,
  type ResultsMapPin,
  type FreeZoneMark,
} from "./ResultsMap";

export { SERIES, seriesFill } from "./chart-series";
