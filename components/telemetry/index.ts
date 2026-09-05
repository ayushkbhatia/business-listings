// The one component in the telemetry tier. It renders nothing and belongs to no
// visual tier — it is here rather than in `display` because a counter is not a
// thing anybody looks at, and `/dev/gallery` has nothing to show for it.
export { PageEvent, emitEvent, type PageEventProps } from "./PageEvent";
