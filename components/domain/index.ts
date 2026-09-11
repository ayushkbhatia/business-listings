// Tier 4. Seven landed in handoff 1; QuoteLineEditor, EnquiryComposer, Thread,
// ModerationRow and AuditRow land in handoff 2. HoursEditor, EmirateAreaPicker
// and PlanCard belong to handoff 3 — the screens that need them are there.
export { VerificationBadge, type VerificationBadgeProps } from "./VerificationBadge";
export { VerificationLadder, type LadderRung, type VerificationLadderProps } from "./VerificationLadder";
export { ListingCard, type ListingCardBusiness, type ListingCardProps, type ListingContext } from "./ListingCard";
export { ProductCard, type Availability, type ProductCardProduct, type ProductCardProps } from "./ProductCard";
export { SpecTable, type SpecRow, type SpecTableProps } from "./SpecTable";
export { CompletenessMeter, type CompletenessMeterProps } from "./CompletenessMeter";
export { ResponseTime, type ResponseTimeProps } from "./ResponseTime";
export { ModerationRow, type ModerationRowProps } from "./ModerationRow";
export { AuditRow, type AuditRowProps } from "./AuditRow";
export {
  Thread,
  type ThreadChip,
  type ThreadLabels,
  type ThreadMessageView,
  type ThreadProps,
  type ThreadQuoteView,
} from "./Thread";
export {
  EnquiryComposer,
  type EnquiryComposerLabels,
  type EnquiryComposerProps,
  type EnquiryComposerValue,
  type EnquiryLineDraft,
  type RecipientPreview,
} from "./EnquiryComposer";
export {
  QuoteLineEditor,
  type MatchReason,
  type QuoteLineCandidate,
  type QuoteLineDraft,
  type QuoteLineEditorLabels,
  type QuoteLineEditorProps,
  type QuoteLineEditorValue,
} from "./QuoteLineEditor";

export {
  TIERS,
  tierSpec,
  isVerified,
  TOP_ACHIEVABLE_TIER,
  type TierSpec,
  type VerificationTier,
} from "./verification";

export { HoursEditor, type HoursEditorProps } from "./HoursEditor";
export {
  EmirateAreaPicker,
  type EmirateAreaPickerProps,
  type AreaOption,
} from "./EmirateAreaPicker";

export { PlanCard, type PlanCardProps, type PlanFeature } from "./PlanCard";
export {
  PlanComparison,
  type PlanComparisonProps,
  type PlanComparisonColumn,
  type PlanComparisonRow,
  type PlanComparisonCell,
  type PlanComparisonState,
} from "./PlanComparison";
export { ReviewCard, ReviewHeldRow, type ReviewCardProps, type ReviewPhoto } from "./ReviewCard";

// Board 1a. The directory home's two compositions.
export { DirectorySearchBar, type DirectorySearchBarProps } from "./DirectorySearchBar";
export { RfqPanel, TrustPanel, type RfqPanelProps, type RfqPanelRow } from "./RfqPanel";

// The 3a/3l amendment. One component, two placements: the overview's category
// position and the analytics panel's query position are different numbers that
// have to render identically.
export {
  PositionValue,
  PositionReason,
  type PositionValueProps,
  type PositionReasonProps,
  type PositionState,
} from "./Position";

// Board `2c-s`. The services field set, shared by the onboarding profile step
// and the dashboard's listing screen so a change to one is a change to both.
export {
  ServiceProfileFields,
  type ServiceProfileFieldsProps,
  type ServiceProfileValue,
  type SectorOption,
} from "./ServiceProfileFields";

// Board `2d-s`. Coverage: how the work reaches the client, where it happens,
// and which free zones the firm is registered in. Mounted by the onboarding
// coverage step and by the dashboard's locations screen.
export {
  CoverageFields,
  type CoverageFieldsProps,
  type CoverageChipView,
  type FreeZoneView,
} from "./CoverageFields";
