-- Loaded by reach.mjs (cloud mode) AFTER every migration has run, as the owning
-- role, so RLS does not apply to these inserts. User A owns one row in every
-- per-user table a client role can SELECT; reach.mjs refuses to pass while any
-- such table is missing here, because a count of zero proves nothing about an
-- empty table. User B owns a collection row, so B's own reads prove B's session
-- is live and a zero from B is a real zero.
DO $fixture$
DECLARE
 a uuid := '00000000-0000-4000-8000-00000000000a';
 b uuid := '00000000-0000-4000-8000-00000000000b';
 series_id bigint; set_id bigint; card_id bigint; variant_id bigint;
 deck_id uuid; list_id uuid; item_id uuid; batch_id uuid; conversation_id uuid := gen_random_uuid();
BEGIN
 -- Signup: the 021/054/068 triggers create app_user, user_settings,
 -- user_profile, billing_account and admin_account for each.
 INSERT INTO auth.users (id, email) VALUES (a, 'a@example.invalid'), (b, 'b@example.invalid');

 -- The smallest catalog the per-user rows can point at.
 INSERT INTO variant_kind (code, display_name, finish, size, tier_derived, tier_rule_version)
  VALUES ('reach-normal', 'Normal', 'normal', 'standard', 'standard', 1);
 INSERT INTO series (catalogue_code, tcgdex_id, slug, name) VALUES ('en', 'reach', 'reach', 'Reach') RETURNING id INTO series_id;
 INSERT INTO card_set (series_id, tcgdex_id, slug, name) VALUES (series_id, 'reach1', 'reach1', 'Reach One') RETURNING id INTO set_id;
 INSERT INTO card (set_id, tcgdex_id, local_id, number_sort, name, name_normalized, category)
  VALUES (set_id, 'reach1-1', '1', '001', 'Probe', 'probe', 'Pokemon') RETURNING id INTO card_id;
 INSERT INTO card_variant (card_id, variant_kind_code, sort_order) VALUES (card_id, 'reach-normal', 1) RETURNING id INTO variant_id;
 -- A second card that is in nobody's deck: what a planted row would target.
 WITH second AS (
  INSERT INTO card (set_id, tcgdex_id, local_id, number_sort, name, name_normalized, category)
   VALUES (set_id, 'reach1-2', '2', '002', 'Probe Two', 'probe two', 'Pokemon') RETURNING id)
 INSERT INTO card_variant (card_id, variant_kind_code, sort_order) SELECT id, 'reach-normal', 1 FROM second;
 INSERT INTO dex_species (id, identifier, name, generation, dex_order) VALUES (1, 'probe', 'Probe', 1, 1);
 INSERT INTO oauth_client (client_id, client_name, redirect_uris) VALUES ('reach-client', 'Reach', ARRAY['https://example.invalid/cb']);

 INSERT INTO collection_item (user_id, card_variant_id, quantity) VALUES (a, variant_id, 3), (b, variant_id, 1);
 INSERT INTO collection_event (user_id, card_variant_id, delta, quantity_after) VALUES (a, variant_id, 3, 3);
 INSERT INTO collection_value_point (user_id, observed_on, currency_code, total_minor, unique_cards, total_quantity)
  VALUES (a, CURRENT_DATE, 'USD', 100, 1, 3);
 INSERT INTO graded_card (user_id, card_variant_id, grader, grade) VALUES (a, variant_id, 'PSA', '10');
 INSERT INTO card_note (user_id, card_id, label, body) VALUES (a, card_id, 'note', 'private');
 INSERT INTO user_showcase (user_id, slot, card_variant_id) VALUES (a, 1, variant_id);
 INSERT INTO user_set_progress (user_id, set_id, goal) VALUES (a, set_id, 'complete');
 INSERT INTO user_dex_state (user_id, dex_id) VALUES (a, 1);

 INSERT INTO deck (user_id, format_code, name) VALUES (a, 'standard', 'A deck') RETURNING id INTO deck_id;
 INSERT INTO deck_card (deck_id, card_id, card_variant_id, user_id, quantity) VALUES (deck_id, card_id, variant_id, a, 2);
 INSERT INTO deck_version (deck_id, version, format_code, cards, user_id) VALUES (deck_id, 1, 'standard', '[]', a);
 INSERT INTO battle_log (deck_id, deck_version, raw_log, user_id) VALUES (deck_id, 1, 'log', a);

 INSERT INTO card_list (user_id, kind, name) VALUES (a, 'static', 'A binder') RETURNING id INTO list_id;
 INSERT INTO list_item (list_id, user_id, list_kind, position, card_variant_id, static_quantity)
  VALUES (list_id, a, 'static', 0, variant_id, 1) RETURNING id INTO item_id;
 INSERT INTO binder_placement (card_list_id, user_id, slot_index, list_item_id) VALUES (list_id, a, 0, item_id);
 -- Not yet placed in a binder: what a planted placement would squat.
 INSERT INTO list_item (list_id, user_id, list_kind, position, card_variant_id, static_quantity)
  VALUES (list_id, a, 'static', 1, variant_id, 1);

 INSERT INTO api_token (user_id, name, token_hash, prefix) VALUES (a, 'A token', repeat('a', 64), 'dsk_aaaaaaaa');
 INSERT INTO oauth_code (code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, expires_at)
  VALUES ('reach-code', 'reach-client', a, 'https://example.invalid/cb', repeat('c', 43), 'S256', now() + interval '5 minutes');
 INSERT INTO bug_report (user_id, description) VALUES (a, 'private report');
 INSERT INTO mutation_batch (user_id, tool) VALUES (a, 'reach') RETURNING id INTO batch_id;
 INSERT INTO mutation_event (batch_id, user_id, entity_type, entity_id, operation) VALUES (batch_id, a, 'deck', deck_id::text, 'create');

 INSERT INTO decke_conversation (id, user_id) VALUES (conversation_id, a);
 INSERT INTO decke_turn (conversation_id, user_id, seq) VALUES (conversation_id, a, 0);
 INSERT INTO decke_usage (user_id, day) VALUES (a, CURRENT_DATE);
 INSERT INTO decke_credit_balance (user_id) VALUES (a);
 INSERT INTO decke_credit_event (user_id, delta, kind, reason) VALUES (a, 1, 'grant', 'fixture');
 INSERT INTO billing_ab_event (user_id, variant, kind, context) VALUES (a, 'with_1', 'shown', 'fixture');
 INSERT INTO scan_exemplar (user_id, card_id, identity_level, pipeline, frame_pipeline_version) VALUES (a, card_id, 'none', 'fixture', 1);

 UPDATE user_profile SET avatar_path = repeat('a', 32) || '.webp', avatar_updated_at = now(),
                         avatar_byte_size = 100, avatar_content_type = 'image/webp'
  WHERE user_id = a;
END $fixture$;
