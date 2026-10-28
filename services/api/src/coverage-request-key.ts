/**
 * The conflict target of the unique index coverage_request_once_key (db/migrations
 * 20261028000100_api_trainer.sql, O-240, PR #25 review MEDIUM 4): one coverage request per user
 * and spot. Index expressions go in their own parentheses. Every coverage_request insert (POST
 * /coverage/requests and POST /sessions' gaps) uses `on conflict (ONCE_KEY_TARGET) do nothing`.
 */
import { sql } from "kysely";

export const ONCE_KEY_TARGET = sql`user_id, game_config_id, position_pair, (coalesce(flop, '')), (coalesce(line, ''))`;
