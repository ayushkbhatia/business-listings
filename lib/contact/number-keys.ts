/**
 * How a revealed number is keyed in the reveal's reply.
 *
 * A location's landline is keyed by the location's id; a team member's line —
 * which defaults to the branch line — by `team:<id>`. Pure, because the server
 * builds the map and the storefront's sections read it.
 */
export const teamNumberKey = (memberId: string) => `team:${memberId}`;
