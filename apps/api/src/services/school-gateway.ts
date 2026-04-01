import type { Env } from "../env.js";

export type SchoolScheduleItem = {
  title: string;
  location?: string;
  startsAt: Date;
  endsAt: Date;
};

export interface SchoolGateway {
  getSchedule(params: {
    userId: string;
    from: Date;
    to: Date;
  }): Promise<SchoolScheduleItem[]>;
}

/** Deterministic mock events; title/location vary by first hex digit of `userId`. */
export class MockSchoolGateway implements SchoolGateway {
  async getSchedule(params: {
    userId: string;
    from: Date;
    to: Date;
  }): Promise<SchoolScheduleItem[]> {
    const { userId, from, to } = params;
    const head = userId.charAt(0).toLowerCase();
    const spanMs = Math.max(to.getTime() - from.getTime(), 120_000);
    const mid = from.getTime() + spanMs / 2;
    const half = Math.min(45 * 60_000, spanMs / 4);
    const startsAt = new Date(mid - half);
    const endsAt = new Date(mid + half);

    const title =
      head === "a" || head === "b"
        ? "Mock: Advanced seminar (prefix track)"
        : "Mock: Core curriculum block";
    const location =
      head === "f" || head === "e" ? "Forum Hall 201" : "Main campus — Room 101";

    const items: SchoolScheduleItem[] = [{ title, location, startsAt, endsAt }];

    if (head === "0" || head === "1") {
      const gapStart = new Date(endsAt.getTime() + 4 * 60 * 60_000);
      const gapEnd = new Date(gapStart.getTime() + 60 * 60_000);
      if (gapEnd <= to) {
        items.push({
          title: "Mock: Lab hours (second block)",
          location: "Science Center B12",
          startsAt: gapStart,
          endsAt: gapEnd,
        });
      }
    }

    return items;
  }
}

export function createSchoolGateway(env: Env): SchoolGateway {
  if (env.SCHOOL_API_MODE === "http") {
    return {
      async getSchedule() {
        throw new Error("SchoolGateway HTTP mode is not implemented");
      },
    };
  }
  return new MockSchoolGateway();
}
