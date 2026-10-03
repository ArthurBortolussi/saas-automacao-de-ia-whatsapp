import {
  aiUsageLevel,
  brazilianNationalHolidays,
  closedPeriodKey,
  easterSunday,
  isOpenAt,
  isQueueOverdue,
  localDateTime,
  memberHasSettingsPermission,
  NEVER_OPEN_PERIOD,
  supportEmailUrl,
  supportWhatsAppUrl,
  type DayOverride,
  type WeeklySchedule,
} from "@arthur-ai/shared";
import { describe, expect, it } from "vitest";
import { estimateMaxCostUsd } from "../src/ai/pricing.js";
import { detectLogoType } from "../src/settings/logo.js";
import { initialSettingsPermissions } from "../src/settings/settings-access.js";

const SP = "America/Sao_Paulo";
const WEEKDAYS_8_18: WeeklySchedule = { alwaysOn: false, days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" };
const none = new Map<string, DayOverride>();
/** Instante a partir do horário de Brasília (UTC-3, sem horário de verão desde 2019). */
const sp = (local: string) => new Date(`${local}:00-03:00`);

describe("Fase 7 — regras puras de horários, feriados e limites", () => {
  describe("[#16 #17] feriados nacionais", () => {
    it("2026: dez feriados nacionais, com a Paixão de Cristo (móvel) e o 20 de novembro", () => {
      const holidays = brazilianNationalHolidays(2026);
      expect(holidays.map((holiday) => holiday.date)).toEqual([
        "2026-01-01",
        "2026-04-03",
        "2026-04-21",
        "2026-05-01",
        "2026-09-07",
        "2026-10-12",
        "2026-11-02",
        "2026-11-15",
        "2026-11-20",
        "2026-12-25",
      ]);
    });

    it("não confunde com pontos facultativos (Carnaval, Cinzas, Corpus Christi) nem com feriados locais", () => {
      const dates = brazilianNationalHolidays(2026).map((holiday) => holiday.date);
      // Carnaval 16–17/02, Quarta-feira de Cinzas 18/02 e Corpus Christi 04/06 de 2026.
      for (const optional of ["2026-02-16", "2026-02-17", "2026-02-18", "2026-06-04", "2026-01-25", "2026-07-09"]) {
        expect(dates).not.toContain(optional);
      }
    });

    it("Páscoa calculada corretamente em anos diferentes; 20/11 só é nacional a partir de 2024", () => {
      expect(easterSunday(2024)).toBe("2024-03-31");
      expect(easterSunday(2025)).toBe("2025-04-20");
      expect(easterSunday(2026)).toBe("2026-04-05");
      expect(easterSunday(2027)).toBe("2027-03-28");
      expect(brazilianNationalHolidays(2025).find((holiday) => holiday.name.includes("Paixão"))?.date).toBe("2025-04-18");
      expect(brazilianNationalHolidays(2023).some((holiday) => holiday.date === "2023-11-20")).toBe(false);
      expect(brazilianNationalHolidays(2024).some((holiday) => holiday.date === "2024-11-20")).toBe(true);
      expect(brazilianNationalHolidays(1800)).toEqual([]);
    });

    it("feriado nacional NÃO fecha a agenda sozinho (só uma data especial da empresa altera o funcionamento)", () => {
      // Sexta-feira, 25/12/2026, 10h: agenda de segunda a sexta segue aberta sem exceção cadastrada.
      expect(isOpenAt(WEEKDAYS_8_18, none, SP, sp("2026-12-25T10:00"))).toBe(true);
      const closed = new Map<string, DayOverride>([["2026-12-25", { mode: "CLOSED", start: null, end: null }]]);
      expect(isOpenAt(WEEKDAYS_8_18, closed, SP, sp("2026-12-25T10:00"))).toBe(false);
    });
  });

  describe("[#18 #19 #20] agenda semanal, exceções e fuso", () => {
    it("aberto dentro do horário e fechado fora dele e nos dias não marcados", () => {
      expect(isOpenAt(WEEKDAYS_8_18, none, SP, sp("2026-10-05T08:00"))).toBe(true); // segunda
      expect(isOpenAt(WEEKDAYS_8_18, none, SP, sp("2026-10-05T17:59"))).toBe(true);
      expect(isOpenAt(WEEKDAYS_8_18, none, SP, sp("2026-10-05T18:00"))).toBe(false);
      expect(isOpenAt(WEEKDAYS_8_18, none, SP, sp("2026-10-04T10:00"))).toBe(false); // domingo
    });

    it("exceção com horário especial e exceção que vira a noite prevalecem sobre a semana", () => {
      const special = new Map<string, DayOverride>([["2026-10-04", { mode: "CUSTOM", start: "22:00", end: "02:00" }]]);
      expect(isOpenAt(WEEKDAYS_8_18, special, SP, sp("2026-10-04T23:00"))).toBe(true); // domingo à noite
      expect(isOpenAt(WEEKDAYS_8_18, special, SP, sp("2026-10-05T01:30"))).toBe(true); // madrugada de segunda
      expect(isOpenAt(WEEKDAYS_8_18, special, SP, sp("2026-10-05T02:00"))).toBe(false);
      const shortDay = new Map<string, DayOverride>([["2026-10-05", { mode: "CUSTOM", start: "08:00", end: "12:00" }]]);
      expect(isOpenAt(WEEKDAYS_8_18, shortDay, SP, sp("2026-10-05T13:00"))).toBe(false);
      const followWeek = new Map<string, DayOverride>([["2026-10-05", { mode: "DEFAULT", start: null, end: null }]]);
      expect(isOpenAt(WEEKDAYS_8_18, followWeek, SP, sp("2026-10-05T13:00"))).toBe(true);
    });

    it("24 horas com um dia fechado; fuso inválido falha fechado", () => {
      const always: WeeklySchedule = { alwaysOn: true, days: [], start: "00:00", end: "00:00" };
      const closed = new Map<string, DayOverride>([["2026-12-25", { mode: "CLOSED", start: null, end: null }]]);
      expect(isOpenAt(always, closed, SP, sp("2026-12-24T23:59"))).toBe(true);
      expect(isOpenAt(always, closed, SP, sp("2026-12-25T00:30"))).toBe(false);
      expect(isOpenAt(always, none, "Marte/Base", new Date())).toBe(false);
    });

    it("o mesmo instante cai em dias e horas diferentes conforme o fuso (horários locais nunca viram UTC)", () => {
      const instant = new Date("2026-10-05T23:30:00Z");
      expect(localDateTime(instant, SP)).toEqual({ date: "2026-10-05", weekday: 1, minutes: 20 * 60 + 30 });
      expect(localDateTime(instant, "Asia/Tokyo")).toEqual({ date: "2026-10-06", weekday: 2, minutes: 8 * 60 + 30 });
      expect(isOpenAt(WEEKDAYS_8_18, none, SP, instant)).toBe(false);
      expect(isOpenAt(WEEKDAYS_8_18, none, "Asia/Tokyo", instant)).toBe(true);
      // Lisboa muda de horário em 25/10/2026: 10h locais antes e depois da mudança continuam abertas.
      expect(isOpenAt(WEEKDAYS_8_18, none, "Europe/Lisbon", new Date("2026-10-23T09:00:00Z"))).toBe(true); // 10h WEST
      expect(isOpenAt(WEEKDAYS_8_18, none, "Europe/Lisbon", new Date("2026-10-26T10:00:00Z"))).toBe(true); // 10h WET
    });
  });

  describe("[#27 #28] período fechado contínuo (aviso de fora do expediente)", () => {
    it("várias mensagens na mesma noite têm o mesmo período; outra noite tem outro", () => {
      const night1a = closedPeriodKey(WEEKDAYS_8_18, none, SP, sp("2026-10-05T19:00"));
      const night1b = closedPeriodKey(WEEKDAYS_8_18, none, SP, sp("2026-10-06T07:59"));
      const night2 = closedPeriodKey(WEEKDAYS_8_18, none, SP, sp("2026-10-06T20:00"));
      expect(night1a).toBe("2026-10-05T18:00");
      expect(night1b).toBe(night1a);
      expect(night2).toBe("2026-10-06T18:00");
      expect(closedPeriodKey(WEEKDAYS_8_18, none, SP, sp("2026-10-06T10:00"))).toBeNull();
    });

    it("o fim de semana inteiro é um único período; feriado cadastrado emenda com o fim de semana", () => {
      const friday = closedPeriodKey(WEEKDAYS_8_18, none, SP, sp("2026-10-09T18:30"));
      const sunday = closedPeriodKey(WEEKDAYS_8_18, none, SP, sp("2026-10-11T15:00"));
      expect(sunday).toBe(friday);
      const holiday = new Map<string, DayOverride>([["2026-10-12", { mode: "CLOSED", start: null, end: null }]]);
      expect(closedPeriodKey(WEEKDAYS_8_18, holiday, SP, sp("2026-10-12T11:00"))).toBe("2026-10-09T18:00");
    });

    it("intervalo da madrugada e agenda sem nenhuma abertura", () => {
      const night: WeeklySchedule = { alwaysOn: false, days: [0, 1, 2, 3, 4, 5, 6], start: "20:00", end: "02:00" };
      expect(closedPeriodKey(night, none, SP, sp("2026-10-05T03:00"))).toBe("2026-10-05T02:00");
      expect(closedPeriodKey({ alwaysOn: false, days: [], start: "08:00", end: "18:00" }, none, SP, sp("2026-10-05T10:00"))).toBe(NEVER_OPEN_PERIOD);
    });
  });

  describe("fila, permissões, consumo, suporte e logotipo", () => {
    it("[#33] espera excessiva: relógio desde a entrada atual na fila", () => {
      const now = new Date("2026-10-05T12:00:00Z");
      expect(isQueueOverdue(new Date("2026-10-05T11:29:00Z"), 30, now)).toBe(true);
      expect(isQueueOverdue(new Date("2026-10-05T11:31:00Z"), 30, now)).toBe(false);
      expect(isQueueOverdue(null, 30, now)).toBe(false);
    });

    it("permissões: proprietário tem tudo; demais só o concedido; ADMIN criado por ADMIN nunca recebe mais que o autor", () => {
      expect(memberHasSettingsPermission({ role: "OWNER", settingsPermissions: [] }, "AI")).toBe(true);
      expect(memberHasSettingsPermission({ role: "ADMIN", settingsPermissions: ["MESSAGES"] }, "AI")).toBe(false);
      expect(memberHasSettingsPermission({ role: "AGENT", settingsPermissions: ["MESSAGES"] }, "MESSAGES")).toBe(true);
      expect(memberHasSettingsPermission(null, "AI")).toBe(false);
      const owner = { role: "OWNER", settingsPermissions: [] } as const;
      const limitedAdmin = { role: "ADMIN", settingsPermissions: ["MESSAGES"] } as const;
      expect(initialSettingsPermissions("ADMIN", null)).toEqual(["AI", "SERVICE", "SCHEDULE", "MESSAGES"]);
      expect(initialSettingsPermissions("ADMIN", { ...owner } as never)).toEqual(["AI", "SERVICE", "SCHEDULE", "MESSAGES"]);
      expect(initialSettingsPermissions("ADMIN", { ...limitedAdmin, settingsPermissions: ["MESSAGES"] } as never)).toEqual(["MESSAGES"]);
      expect(initialSettingsPermissions("AGENT", null)).toEqual([]);
    });

    it("[#46 #47] níveis de consumo: 80% e 100% do limite; sem limite", () => {
      expect(aiUsageLevel(0.79, 1)).toBe("OK");
      expect(aiUsageLevel(0.8, 1)).toBe("NEAR_LIMIT");
      expect(aiUsageLevel(1, 1)).toBe("LIMIT_REACHED");
      expect(aiUsageLevel(5, null)).toBe("NO_LIMIT");
    });

    it("estimativa conservadora antes da chamada (entrada pelo maior preço + saída máxima); sem preço → null", () => {
      const price = { inputPerMTok: 2, outputPerMTok: 10, cacheWritePerMTok: 2.5, cacheReadPerMTok: 0.2 };
      // 3000 caracteres → 1000 tokens × $2,50 + 256 tokens × $10 por milhão = $0,005060
      expect(estimateMaxCostUsd(3000, 256, price)).toBe("0.005060");
      expect(estimateMaxCostUsd(3000, 256, null)).toBeNull();
    });

    it("[#65] links de suporte seguros", () => {
      expect(supportWhatsAppUrl("5511999990000")).toBe("https://wa.me/5511999990000");
      expect(supportWhatsAppUrl("javascript:alert(1)")).toBeNull();
      expect(supportEmailUrl("suporte@arthur.ai")).toBe("mailto:suporte@arthur.ai");
      expect(supportEmailUrl(null)).toBeNull();
    });

    it("logotipo: tipo conferido pelos bytes (PNG, JPEG, WEBP); SVG e texto recusados", () => {
      expect(detectLogoType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
      expect(detectLogoType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
      expect(detectLogoType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]))).toBe("image/webp");
      expect(detectLogoType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>"))).toBeNull();
      expect(detectLogoType(Buffer.from("texto qualquer"))).toBeNull();
    });
  });
});
