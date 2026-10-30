/**
 * The starter drill pack (S47, R3.35, O-481): ten export codes the library offers on day one, so
 * practising starts before the builder is learned and the builder is learned by editing. Each code
 * is g-tee-oh's own format (O-310) made by the api's encoder from the drills of
 * validation/fixtures/drills/starter-pack.json, where `just drill-acceptance` proves each runs on
 * the fixture library; the tenth, Squeeze from the blinds, is bundled although the synthetic pair
 * trees cannot serve it, so its row shows "Not built yet" rather than hiding a spot (ADR 0018).
 * services/api/test/drills-starter-pack.test.ts holds these codes to the real encoder and
 * web/test/drills/starter-pack.test.ts to the write rules and the catalogs. Every drill carries
 * STARTER_TAG, which is how the library knows the pack was added.
 */
export const STARTER_TAG = "starter";

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
    code: "gteeoh1.eJxVkTFv3DAMhf_K4c0ckqWDxnRo0aEZmkzBQaDPtCOcTKmifEAS-L8X9B3adCPIR_J75AeUF0HAYxU9lHaYSh7DQS7S3g4m3EGwWnqcUu7SED7AHih3iV43hImzCWHmReKp6JRml41S-6vFYUB4ub-7OxKm0hbuCCiakwoInYcs0dK7IHzZCK-so3nzUkaHOuViEkc5JUtFDS6RVmItlvqeCS94fvoGwvcfIHx9BOHh6ScIvx5wJNQmUy418snlrm5T8oKl96Tz51VFL6K7aiNY57N8JrXOrUfrTcQd3OaCcEk5c9L_kI6bW5t3ur1RGmjfTBjKqiO3N4fojZNejzq3stadyDtcMYKQtK6-7opvIFRWyX6izePVHJKnLi0u6QpN-L2m0zk2sTX3v99pPvsWWxUZEaD-kLy7KzW2Nf-bdjvY7UWGcE_oaZGB9RwNQdect-0PIUbFEw",
  },
  {
    key: "open-button",
    name: "Open or fold: button",
    code: "gteeoh1.eJxVkbFuHDEMRH_lMLUKu0mh0h-QNOmMg8Dd5a6F01KKSBmIjf33gHuHxOkIcTh8HH1CaGdE_Ggsl9ovay1LvEzDrAoCtFVLay7GHfET5IWQcVImU8SVinLARjunucqaN5ct3OxN0zQhvj4_PV0D1tp3MkRUKVkYAUZT4aT5gxG_HQFvJIv68F4XB5pLVU4Lz1lzFYVLuNfUqmY7X-IrXn5-xzWgdV5LbYlm73ijr9kbmj-ybF9dq7yznKojQI1u_BVKjboltc7ssA9fBLznUijLf9uvh1-xnSDnIHeEc3PAVIcs1H87hHXKcs9v63W0k8gnXLEgIEsbvu6OrwhoJFw8jcProQ5Jq3FPe75DB_waeb6lzjqK_f2I7t6PWhvzggjx7Mt5XW2pj_LP7RHY4zcU8TnA8s4TyS0pooxSjuMPPtC_Tg",
  },
  {
    key: "bb-vs-btn",
    name: "Big blind facing a button open",
    code: "gteeoh1.eJxdkcFu3DAMRH9lMWcVSC496Lgf0FNvwUKgbdohVqZUkd5DAv97IK_RBr1R0pB6M_yE0sqIuMpyGbLodJlpFF0udBk296KXUlkRYLV4miU7N8RPUC-UnJMxuSHOlI0DFlo5jUVnWbps4urvloYB8e315eUWMJe2kiOiaBZlBDgNmZPJByP-3APeSSfrzWuZOtqYi3GaeBSTooYu4VZSLSZ-3MQ3XK-4BdTGcy410dgf-v3D0mHgFmDyIbp8H1z0wXoo9wBzuvN3LnNqnswbc-c9ZyPgITmT6H8Av3_htnc3y3E-url1uf04MxyGzuGNRJ8pLq1s9YDqep2oTQgQrVv_8enCEFBJOfdM9l5v1jlpdm5plSd3wJ9NxntqbFv2v-toffZZW2WeEKF9A_kwWGpqW_437czt3Ikhvga4rDyQ3pMh6pbzvn8BAEbEOg",
  },
  {
    key: "bb-vs-co",
    name: "Big blind facing a cutoff open",
    code: "gteeoh1.eJxVkTFu5DAMRa9i_FoBkiaFyskB9gDBQKBtyiFGphRRniKB7x7IY-xmO0r6pN7__IbSyvC4yDKMSXQeIk2iy0DDtLUc45ALKxys5BaipMYV_hvUC6XGwZiawUdKxg4LrRymrFGWLpu5tA8L4wj__vL8fHWIua7U4JE1iTIcGo2Jg8kXw7_uDh-ks_XmNc8dbUrZOMw8iUlWQ5dwzaFkk3bc-HdcLrg6lMox5RJo6g_9_m7hMHB1MPkSXX4PznpnPZS7gzW68W8ua1RbsFaZO-85Gw53SYlE_wd4-4Pr3s0sx_Fo5trV9nRGOI4do1USfYS41LyVg6nrdaY6w0G0bP3DhwmDQyHl1CPZe71Zx6TYuIZVHtgOn5tMt1DZttT-bqP22WdthXmGh_YFpMNfLqFu6d-0M7ZzJQb_4tBk5ZH0Fgxet5T2_QcV5sPT",
  },
  {
    key: "sb-vs-btn",
    name: "Small blind facing a button open",
    code: "gteeoh1.eJxVkcFu3DAMRH_FmLMKJJcedMwH9JLegoVA27QjrEypIr2HBP73gt5tm94oaUi9GX5CaGNEvG5UyjCWLPOw0JRlHWgYd7MqQ20sCNBWLS25GHfET5AXQsZJmUwRFyrKASttnKYqS15dNnOzd03jiPj2_PR0CVhq38gQUaVkYQQYjYWT5g9G_H4EvJPM6s1bnR1uKlU5zTxlzVUULuFeU6ua7byJb3h9wSWgdV5KbYkmf_D7m6bTwCVA80eW9evgKjeWU3kEqNGVv3KpUbek1pmd9zEbAbdcCmX5H-Dl5w9cDneznuezm7vL9dufDEfnsE5Z7imuve7thHK9zNRnBGRpu_94d6EIaCRcPJPD612dkxbjnrZ85w74tefpmjrrXuzvOrrPftTamGdEiG-gnAZrS30v_6Y9cnvsRBGfAyxvPJJckyLKXspx_AYh-8VD",
  },
  {
    key: "btn-vs-3bet",
    name: "Button facing a 3-bet from the blinds",
    code: "gteeoh1.eJxVUUFu3DAM_IoxZwVIECAHHf2AXpJbsBBom_YKK1OKSC-QLPz3Qs62TW8EORzODG8QWhke_WaWpZtpjLJ01D0_DGzdXPPa2Zm7IUWZFA5asoU5JuMKfwO1Qsg4KJMp_ExJ2WGhlcOYZY5Lg01c7KxhGODfnx4fTw5zrisZPLKkKAwHoyFx0PjF8C-7w5naRX_DmqemkFJCa3PNoWSNFrMo_Dv6t184OZTKc8ol0NgmbXDVYOfKHAa2htD4FWX5QTlmubIc8N1BjS78U5EaVQtqlbkpvR-AwzWmRFH-l_Haw6Hvcdqbl-XoHQxc24o-PN9lWKUo3_EtNW_l0NSgMlGd4BClbO3gt5OWeiHh1MLYW71pk8lXrp9_3Dp8bHG8hMq6Jfv7htqo77UW5gke0pJPh71cQt3SEe5sXP-RHb9Q-CcHiysPJJeg8LKltO-_AY6LwrI",
  },
  {
    key: "3bet-ip-co-vs-hj",
    name: "3-bet in position: cutoff over the hijack",
    code: "gteeoh1.eJxVkbFu3DAMhl_F4KwCFwTooDVL0aUPEBwE2qZt9mRKEekbEvjdA_quyXWjxJ_kx58fILgSRHj-0ZN1LF0tysZFYjdsVqapK1dqnS3ULfwXhwsE0FosTZyNGsQPQA8EjZISmkKcMCsFmHGlNBSZeHbZSNUWTX0P8fXpdDoHmEpb0SBCkcxCEMCwz5SU3wnizz3AgjKqF69ldMohF6U00sDKRRRcQq2kf9AK8RVe_sA5QG005VITDp7wf1saUerJPK38zjI_ti5yJTm0ewA1vNAjmRo2S2qNyInv3SHAlXNGlv8Rfv2G8-7rzMfzKKYGAZ59fACuzmANWW4ezq1s9QBysYzYRpdJ3XzabQeFABWFsjuye7ypM-Jk1NLKN-YAbxsPl9RIt2xfx2je-x5rJRohgrj_-Viu1NS2_N3t7tr9IgrxKYDxSj3KJSlE2XLe908-6Mdm",
  },
  {
    key: "3bet-oop-blinds-vs-btn",
    name: "3-bet out of position: blinds versus a button open",
    code: "gteeoh1.eJxVkUFu3DAMRa9i_LUKJAjQhZZzgG7aXTAQZJv2CCOTikjNIoHvHsgzadMdCX5-PpIf4LgRPF5-jGSDNBtkGYposiTshzEnnnW4UdWmQxzGZiY8SCGGgxaxsKRsVOE_EHvA0SgoRVP4JWYlhzVuFCbhJa1dNlOxi4ZxhH99fno6OyxSt2jwEM6JCQ4Wx0xB0zvB_9wdLpFn7c2bzB13yqIUZpqSJmFFl1CV8EWu8K_4fYLD6YSzQ6m0ZCkhTr3ai3apRGEk62VN74nX7_7CN-JDuzuoxSt9x1OL1YJaJerYD3c43FLOMfH_HKc_v3De-1LrkR_dVOHw0uc7iJROYTUmvp9yrdLKgdTVPMc6wyFxaX3efQuFQ4lMuR9m73HTThkXoxq2dKd2eGtpuoZK2rL9_Unt3o9YC9EMD-5vyMd6UkJt-Z_b426Pxyj8s4OljcbI16Dw3HLe90-cZsyf",
  },
  {
    key: "squeeze-blinds",
    name: "Squeeze from the blinds",
    code: "gteeoh1.eJxVkbtuwzAMRX8luLOGdumgMb_QsQgEOqYdITKlinSHBP73gk7Qx0aY9OXh0R1CCyPi_XNlvvFh6nU52IUPQ8kyKgK0VUtTLsYd8Q7yQsg4KZMp4kRFOWCmhdO5ypRnHxu52UXTMCB-vL68nAKm2hcyRFQpWRgBRkPhpPnGiG9bwIV8Y7xjqaMzUSnwz9xralWz5SqK-IH3IwKOR5wCWuep1Jbo7F1v6uMSb2q-ZZn_JJ6rfLHsk1uAGl35L5AadUtqndlBn9kI-MqlUJZ_FKfNL5h3oP1H7h7xu906ZXlIm3td247iozJSHxGQpa2-58HurhsJF1eweb3qbmEy7mnJD9qAzzWfr6mzrsV-7HfPftbamEdEiAsv-1m1pb6W37SnrecTKOJrgOWFB5JrUkRZS9m2b419vAk",
  },
  {
    key: "live-13-open-every-seat",
    name: "Live 1/3: open or fold, every seat",
    code: "gteeoh1.eJxVUctO7DAM_ZXqrC1BYUWWsOAKoXsXwAqNoszULdGkSYjTSoD678id8rgbx_Hj-Pj4A9GNDIN7P3PTnl2aJmWOTSpNn0JHDc9c3hphV0GQnKrtfahcYD7g1ImustW8wPQuCBMGN7I9pNj7Qcs6zvVF7H4P89yen-8IfSqjqzAIfmYQqtsHtuLfGeZqIby42Im2jqlTci4EaJhLsjmJrz5FgXnG0-MtSG17ei5AuL8D4Y-am38gXD_-BeHhGjtCLtyHlK07KIIClN5rQvy7j8OviYcUZ45r1UKQ6o4abc8usf5KtVILs-6wgYIw-xCcj_9R3C263rCyXRu5gL723qbX4nw8STqUNOWVilbHzpUOBB_zpKNOvAWE7CIHlWhRf5JVpb5ysaM_sSW8Tv5wtIVlCvX7NkWxN18ycweDqOcI62Yp2zKFH7RNqe1EAtMSqh957-LRCkycQliWT13PwnY",
  },
];
