/**
 * The starter drill pack (S47, R3.35, O-481): ten export codes the library offers on day one, so
 * practising starts before the builder is learned and the builder is learned by editing. Each code
 * is g-tee-oh's own format (O-310) made by the api's encoder from the drills of
 * validation/fixtures/drills/starter-pack.json, where `just drill-acceptance` proves each runs on
 * the fixture library; the tenth, Squeeze from the blinds, is bundled although the synthetic pair
 * trees cannot serve it, so its row shows "Not built yet" rather than hiding a spot (ADR 0018).
 * services/api/test/drills-starter-pack.test.ts holds these codes to the real encoder and
 * web/test/drills/starter-pack.test.ts to the write rules and the catalogs. Every drill carries
 * STARTER_TAG, which is how the library knows the pack was added, and its own id tag (starterIdTag),
 * which is how it knows which entry a drill is, whatever the user renames it to.
 */
export const STARTER_TAG = "starter";

const STARTER_ID_PREFIX = "starter-";

/** The tag a starter drill keeps through a rename: "starter-" and its pack key (PR #48 review 4 finding 3). */
export function starterIdTag(entry: Pick<StarterDrill, "key">): string {
  return `${STARTER_ID_PREFIX}${entry.key}`;
}

/** What the presence rule reads of a listed drill carrying STARTER_TAG. */
export interface StarterMark {
  readonly name: string;
  readonly tags: readonly string[];
}

/** True for a starter id tag, whichever pack entry it names. */
function isStarterIdTag(tag: string): boolean {
  return tag.startsWith(STARTER_ID_PREFIX);
}

/**
 * The starter drills the user does not have yet, in pack order (PR #48 review round 2 MEDIUM 3), so
 * a pack that landed partway offers only the rest. A pack entry counts as present when a listed
 * drill carries its id tag, so a renamed starter drill is never imported twice (review 4 finding
 * 3), or, for a drill imported before the id tags (one carrying no id tag at all), has its name;
 * a drill with an id tag is known by it alone, so one starter drill renamed to another's name
 * hides neither (PR #51 review round 2).
 */
export function missingStarterDrills(listed: readonly StarterMark[]): readonly StarterDrill[] {
  const tags = new Set(listed.flatMap((drill) => drill.tags));
  const names = new Set(listed.filter((drill) => !drill.tags.some(isStarterIdTag)).map((drill) => drill.name));
  return STARTER_PACK.filter((entry) => !tags.has(starterIdTag(entry)) && !names.has(entry.name));
}

export interface StarterDrill {
  /** A stable key for lists and tests. */
  readonly key: string;
  readonly name: string;
  readonly code: string;
}

export const STARTER_PACK: readonly StarterDrill[] = [
  {
    key: "open-every-seat",
    name: "Open or fold: every seat",
    code: "gteeoh1.eJxVUTFu3DAQ_Mph6j3AblKwdIoEKeIiTmUcCEpaycRRS4ZLHWAb-nuwvEvidAtyZnZm9h0SVobDY2E55HqYc5rcgS9cXw_KoYGgJTc_x9S4wr0j2CChsbd_hZtDUiYsYWU_ZpnjYrCJS3tRPwxwz_d3dyfCnOsaGhyypCgMQgtDYq_xjeE-7YSXIJMaec2TmRpTVvYTj1FjFoVBuGZfssbWX9wzfj59AeHrNxA-P4Lw8PQdhB8POBFK5Tnl4sNocEPXOdqHxrcoy8dVWS4sHbUTtIUzf3SqLdTmtVVmS3DTBeESUwpR_rN02i3a0t11IldQ30wY8iZTqK9_NLkec2E59saPvfETodUQ5Vr3UvNWulcjGHcCIUrZzMg1mIJQgnCy8nabNzX7YW5c_RqvcQi_tjiefWXdUvt7t2rat1kL8wQHsVOl7jEXX7f0T-1W5e14CndPaHHlIcjZK5xsKe37b_yTzpk",
  },
  {
    key: "open-button",
    name: "Open or fold: button",
    code: "gteeoh1.eJxVkcFu3DAMRH9lMWcFSC496NgPSC-9BQuBtmlHWJlSRTpAE_jfA3rdNr0R4nD0OPyA0MqI-NFYLrVf5lqmeBk2syoI0FYtzbkYd8QPkBdCxkmZTBFnKsoBC62cxipzXlw2cbNXTcOA-PL0-HgNmGtfyRBRpWRhBBgNhZPmd0b8tge8kkzqw2udHGgsVTlNPGbNVRQu4V5Tq5rteIkv-P7zGdeA1nkutSUaveONPmdvaH7Psnx1rfLGcqj2ADW68VcoNeqW1Dqzw56-CHjLpVCW_36_7r7FcoAcg9wRjp8DhrrJRP33H0_uD7WxPJzBXgOsU5Z7qkuvWzs4XexzEwKytM0h7kspAhoJF89o93pTR6fZuKc131cJ-LXl8ZY661bs73m6e5-1NuYJEeIXKQdfbalv5Z_bGeN5I0V8CrC88kByS4ooWyn7_glgBMdr",
  },
  {
    key: "bb-vs-btn",
    name: "Big blind facing a button open",
    code: "gteeoh1.eJxdkbFu3DAMhl_F4KwDkqWDxnuATt2Cg0DZtEOcTKkifUMCv3tAn9sG3Sjq54_vJz9BcCWIcOVlyIVlGmYcWZYBh7yZVRlqI4EA2qqlmYtRh_gJ6IWgUVJCU4gzFqUAC66UxiozLy6bqNm7ppwhvr2-vNwCzLWvaBChSmEhCGCYCyXlD4L4Yw_wjjKpD691crSxVKU00cjKVRRcQr2mVpXt6MQ3uF7hFqB1mkttCUf_8P5D0xHgFkD5g2X5blzlQXIo9wBqeKfvXGrYLal1Iuc9vSHAg0tBlv8Afv2E2-5pluN9TFN3uV7OHeb8x5b6JefLQy_ZDjbryPLc7NLr1g5Ql8qEfYIALG1zimcyhQANhYrvafd6U2fH2ainlZ9ZAvzeeLynTroV-3ui7t5nrY1oggjiVykHXW2pb-Wf27nL804K8TWA8UoZ5Z4Uomyl7PsXkq7LJw",
  },
  {
    key: "bb-vs-co",
    name: "Big blind facing a cutoff open",
    code: "gteeoh1.eJxVkUFu3DAMRa9i_LUGSDZdaDk9QA8QDATKph1iZEoV5Vkk8N0Dedw23VHU58f75CeUVobHVZYhJtFpmGkUXQYaxq3leR5yYYWDldzCLKlxhf8E9UKpcTCmZvAzJWOHhVYOY9ZZli6buLR3CzHCv72-vNwc5lxXavDImkQZDo1i4mDywfA_dod30sn68JqnjjambBwmHsUkq6FLuOZQskk7Ov4N1ytuDqXynHIJNPaP3n9YOALcHEw-RJfvxlkfrIdyd7BGd_7OZY1qC9Yqc-c9veHwkJRI9H-An79w23uY5Xgew1y72i7nCmP848r1EuPlYZcxd7JWSfS516XmrRyYXakT1QkOomXrDM9cBodCyqlvae_1Zp2c5sY1rPJM4vB7k_EeKtuW2t8D1e591laYJ3hov0k64HIJdUv_3M5Nnlcy-FeHJitH0nsweN1S2vcvwkzKTg",
  },
  {
    key: "sb-vs-btn",
    name: "Small blind facing a button open",
    code: "gteeoh1.eJxVkbFu5DAMRH_FmFoLJE0KlfmANLkuWAiUTTvCypQi0lsk8L8H8m7uch1FDQdvyC8IrQyP15VyHmJOMg0zjUmWgYa4mRUZSmWBg9ZiYU7ZuMF_gXohZByUyRR-pqzssNDKYSwyp6XLJq72riFG-LfHh4ezw1zaSgaPIjkJw8EoZg6aPhn-aXd4J5m0D69l6nBjLsph4jFpKqLoEm4l1KLJjo5_w-szzg618ZxLDTT2j96_ajgCnB00fSZZfhsXubIcyt1BjS78m0uNmgW1xtx5795wuKacKcn_AM9_XnDee5rleB_T3LpcTz87jD-23E4aT1c9RTvYrFGS22aXVrZ6gHapTNQmOCSpW6e4JVM4VBLOfU97rzft7DQbt7CmWxaHjy2Nl9BYt2x_T9S6973WyjzBQ_pV8kFXamhb_ud23-X9Tgr_6GBp5UhyCQovW877_g3WxcxB",
  },
  {
    key: "btn-vs-3bet",
    name: "Button facing a 3-bet from the blinds",
    code: "gteeoh1.eJxVkcFu3DAMRH_FmLMWSBCgBx39Abm0t2Ah0DbtFVamVIleoFn43ws62TS9EdSIfJy5Q2hlePSbapZupjHK0lH3chpYu7nmtdMLd0OKMjU4tJI1zDEpV_g7yAoh5dCYtMHPlBo7LLRyGLPMcTHZxEUvLQwD_Nvz09PZYc51JYVHlhSF4aA0JA4tvjP8j93hQrbR37HmyQgpJVibaw4lt6gxS4N_Q__rFWeHUnlOuQQa7cUebi3opTKHgdUULb5HWb6NHLPcWA757tCUrvydqClVDU0rs5F-LoDDLaZEUf7H-NnDoe9x3u2W5egdE7jal3Z6MQz36J0GldOje3bQSlE-TF1q3spBamKZqE5wiFI2w_i4z7IoJJzMot3qrRk837j-eXjg8HuL4zVUblvSr3Cqjf6sW2Ge4CGWRzrwcgl1S4fls3L9N-xIqME_O2hceSC5hgYvW0r7_heQs8pJ",
  },
  {
    key: "3bet-ip-co-vs-hj",
    name: "3-bet in position: cutoff over the hijack",
    code: "gteeoh1.eJxVkU1u3DAMha9icC0DCQJ0oW03RTc9QDAQaJu2mZEpVaRnkcB3L-iZtOnuiT9PH8kPENwIIrz0A1nH0tWibFwkduNuZZ67cqPW2Urdym84XiGA1mJp5mzUIH4AuhA0SkpoCnHGrBRgwY3SWGTmxcsmqrZqGgaIr89PT5cAc2kbGkQoklkIAhgOmZLyO0H8dgRYUSb15q1MTjnmopQmGlm5iIKXUCvpE1ohvsL3X3AJUBvNudSEoyc8bmsjSgOZp5XfWZav1kVuJGftEUANr_SVTA2bJbVG5MQPdwhw45yR5X-EHz_hcvg4y_k8m6lBgBf_PgDXT0tqvcd6rv1Y-pv265vjWUOW-3qXVvZ6snqHTNgmd5C6O8h9PIUAFYWyL-twvavj42zU0sb3cQL83nm8pka6Z_t7p-beD62VaIII4qfJJ2Spqe35n9tjoY9jKcTnAMYbDSjXpBBlz_k4_gCVL9CQ",
  },
  {
    key: "3bet-oop-blinds-vs-btn",
    name: "3-bet out of position: blinds versus a button open",
    code: "gteeoh1.eJxVkU1u3DAMha9ivLUMJAjQhZZzgG7aXTAQZJv2CCOTqkjPIoHvXsjjtumO4s_Tx8dPcFwJHm_9QNbJZp3MXRFNloR9N-TEk3YPqrppF7thMxPupBDDQYtYmFM2qvCfiC3gaBSUoin8HLOSwxJXCqPwnJbWNlGxm4ZhgH9_fXm5OsxS12jwEM6JCQ4Wh0xB0wfBf9sdbpEnbcOrTA13zKIUJhqTJmFFa6Eq4Q-5wr_jxwUOlwuuDqXSnKWEOLZqK9qtEoWBrJU1fSRevuoLP4iP3t1BLd7pK55arBbUKlHDPtXh8Eg5x8T_c1x-fsd1b0stx_uYpgqHt_a_gxyzZ7pvyV6k9E_z-4f2g3HDtBoTP71eqmzlYG5zPMU6wSFx2RrQc02FQ4lMuTm3t3jTtkacjWpY03Mth19bGu-hkm7Z_h6tNu0z1kI0wYPbnfKBKiXULf9TO409L6fwrw6WVhoi34PC85bzvv8G7HnYWg",
  },
  {
    key: "squeeze-blinds",
    name: "Squeeze from the blinds",
    code: "gteeoh1.eJxVkb1uwzAMhF8luFkBmqWDxrxCxyIQ6Jh2hMiUIsoZEvjdCzru30aQ1Om74xNCE8Pj4zYzP3g31Dzt2oV3XYrSKxy05BaGmBpX-CfICqHGQZmawg-UlB1GmjicswxxtLWeS7to6Dr4z8Pb28lhyHWiBo8sKQrDoVGXOGh8MPz74nAh-9E_MeXemCglWJtrDiVrbDGLwn_i4wiH4xEnh1J5SLkEOtvUhvpyYkONjyjjH8VzljvLurk4aKMr_wXSRrUFbZXZQDdtONxjShTlH8VpMQfjCrQ-5GoS2-_uu7ffOvst0JNDqxTlleZY81xWRtuXnmoPhyhlNoCXKTtCIeFk2SxWz7rGMzSuYYovGw63OZ6vobLOqf2cpZr2Vmth7uEhdom0IuYS6px-1bYYt9so_MGhxYk7kmtQeJlTWpYv0rDFVg",
  },
  {
    key: "live-13-open-every-seat",
    name: "Live 1/3: open or fold, every seat",
    code: "gteeoh1.eJxVUctO5DAQ_JWozh1Bdk74CIddIbQcYE9oZHkmnWCNYxu3E2lB-XfUmWEfF7vdj3JV9QeimxgGD37hprvamSZljk0qzZBCTw0vXH43wq6CIDlVO_hQucB8wGkQXWWrdYEZXBAmjG5ie0xx8KO29Zzrq9jDAealu77eE4ZUJldhEPzCIFR3CGzFvzPMzUp4dbEXHZ1Sr-RcCNA0l2RzEl99igLzgl_P30F6dufrGwgP9yD80OPuEYTb558gPN1iT8iFh5CydUdFUIAyeC2If_dx_OfHY4oLx61rJUh1J812Vztsr1Kt1MKsGi6gICw-BOfjfxT3q8obN7bbIBfQl279nb7SrSbbbtfqAtrN93bzfU-oxfl4Nn0sac4bWR2MvSs9CD7mWcmclQkI2UUOauKq8Sybj0PlYid_1kN4m_3xZAvLHOqf7RXFvsSSmXsYRF1Y2LimbMsc_qJdvLwsUWA6QvUTH1w8WYGJcwjr-gkRkc5q",
  },
];
