-- Decision N10, task T6.8 — SMS leaves the product.
--
-- It had no carrier. `lib/notify/senders/index.ts` bound the channel to the
-- console sender, so a seller who ticked SMS on board 7e was promised a text
-- message and sent a line in a server log. WhatsApp reaches the same handset
-- for a fraction of the cost and is the channel the copy already promises.
--
-- Three writes, and none of them loses a record of what happened.
--
-- ## 1 · The two bodies are retired, not deleted
--
-- `notification_delivery.template_id` points at them and the log is a record of
-- what was sent: the seeded history alone holds 96 `enquiry_received` and 21
-- `quote_accepted` SMS deliveries, each of which would lose the body it went
-- out with. `retired` is the status for exactly this, and
-- `tests/unit/notification-templates.test.ts` holds the catalogue and this file
-- in step.
--
-- ## 2 · `sms` leaves every stored matrix
--
-- `route()` skips a retired channel with `channel_retired` rather than dropping
-- it silently, so a stored choice would otherwise write one countable skip row
-- per message for ever. This strips the key, so that count reaches zero and
-- stays there — and a seller re-saving board 7e cannot put it back, because the
-- channel is no longer on the screen.
--
-- `jsonb - 'sms'` on the **value** of each event, not on the matrix: the matrix
-- is `{ event: [channels] }`, so the channel lives inside each array.
--
-- ## 3 · Nothing touches auth
--
-- `CodeChannel` in `lib/auth/flow.ts` is also called `sms`, and it stays: a
-- sign-in code sent by the Supabase phone provider is not a notification, has a
-- real carrier, and is the only way a buyer with no email signs in. The channel
-- being retired is the *alerts* channel.
--
-- Additive in effect and applies before the merge: the code that stops offering
-- SMS can ship over a database that has already stopped storing it.

UPDATE "notification_template"
   SET "status" = 'retired'::"template_approval",
       "updated_at" = CURRENT_TIMESTAMP
 WHERE "channel" = 'sms'::"notification_channel"
   AND "status" = 'live'::"template_approval";

UPDATE "notification_preference" p
   SET "routing" = (
         SELECT coalesce(
                  jsonb_object_agg(
                    entry.key,
                    (SELECT coalesce(jsonb_agg(channel), '[]'::jsonb)
                       FROM jsonb_array_elements_text(entry.value) AS channel
                      WHERE channel <> 'sms')
                  ),
                  '{}'::jsonb
                )
           FROM jsonb_each(p."routing") AS entry
       )
 WHERE p."routing" IS NOT NULL
   AND p."routing"::text LIKE '%"sms"%';
