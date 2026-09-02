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
export { StepProgress, type StepProgressProps } from "./StepProgress";
export { StackedBar, type StackedBarProps, type StackedSegment } from "./StackedBar";
export { FunnelBars, type FunnelBarsProps, type FunnelStage } from "./FunnelBars";
export { ShareBars, type ShareBarsProps, type ShareRow } from "./ShareBars";
export { Waterfall, type WaterfallProps, type WaterfallStep } from "./Waterfall";
export { ImagePlaceholder, type ImagePlaceholderProps, type PlaceholderKind } from "./ImagePlaceholder";
export { LogoTile, type LogoTileProps } from "./LogoTile";
export { CategoryMark, type CategoryMarkProps } from "./CategoryMark";
// The mono uppercase label. One of exactly two places §08 allows uppercase.
export { Eyebrow, type EyebrowProps } from "./Eyebrow";
export { MapCanvas, type MapCanvasProps, type MapPin } from "./MapCanvas";
// Board 1c's results map. Separate from MapCanvas because it clusters, which
// means a GeoJSON source and paint layers rather than DOM markers.
export {
  ResultsMap,
  type ResultsMapProps,
  type ResultsMapPin,
  type FreeZoneMark,
} from "./ResultsMap";

export { SERIES, seriesFill } from "./chart-series";
