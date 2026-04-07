import { PlannerError } from "./errors.ts";
import { createId } from "./ids.ts";
import { addMinutesToIso } from "./time.ts";
import type { Itinerary, PlannerCommand, PlannerCommandTranslator } from "./types.ts";

export class RuleBasedCommandTranslator implements PlannerCommandTranslator {
  async translate(input: {
    trip: Itinerary;
    utterance: string;
    context?: { selected_day?: string; selected_item_id?: string };
  }): Promise<PlannerCommand[]> {
    const lower = input.utterance.toLowerCase();
    const day = inferTargetDay(input.trip, lower, input.context?.selected_day);
    const selectedItem = input.context?.selected_item_id
      ? input.trip.days.flatMap((candidate) => candidate.items).find((item) => item.id === input.context?.selected_item_id)
      : undefined;

    if (matchesAny(lower, ["delete", "remove", "删掉", "删除"]) && matchesAny(lower, ["stop", "item", "place", "activity", "这项", "这个地点", "this stop", "selected"])) {
      if (!selectedItem) {
        throw new PlannerError("invalid_command", "Select a stop before asking to remove it.");
      }

      return [
        {
          command_id: createId("cmd"),
          action: "delete_item",
          item_id: selectedItem.id,
          day_date: day.date,
          reason: input.utterance,
        },
      ];
    }

    if (matchesAny(lower, ["add day", "extend trip", "加一天", "多一天"])) {
      return [
        {
          command_id: createId("cmd"),
          action: "add_day",
          day_date: day.date,
          reason: input.utterance,
        },
      ];
    }

    if (matchesAny(lower, ["delete day", "remove day", "删掉这一天", "删除这一天"])) {
      return [
        {
          command_id: createId("cmd"),
          action: "delete_day",
          day_date: day.date,
          reason: input.utterance,
        },
      ];
    }

    if (matchesAny(lower, ["lock", "锁定"]) && matchesAny(lower, ["this", "selected", "stop", "item", "当前", "这个"])) {
      if (!selectedItem) {
        throw new PlannerError("invalid_command", "Select a stop before asking to lock it.");
      }

      return [
        {
          command_id: createId("cmd"),
          action: "lock_item",
          item_id: selectedItem.id,
          day_date: day.date,
          reason: input.utterance,
        },
      ];
    }

    if (matchesAny(lower, ["unlock", "解锁"]) && matchesAny(lower, ["this", "selected", "stop", "item", "当前", "这个"])) {
      if (!selectedItem) {
        throw new PlannerError("invalid_command", "Select a stop before asking to unlock it.");
      }

      return [
        {
          command_id: createId("cmd"),
          action: "unlock_item",
          item_id: selectedItem.id,
          day_date: day.date,
          reason: input.utterance,
        },
      ];
    }

    if (selectedItem && matchesAny(lower, ["later", "延后", "往后", "晚一点", "后移"])) {
      return [
        {
          command_id: createId("cmd"),
          action: "move_item",
          item_id: selectedItem.id,
          day_date: day.date,
          reason: input.utterance,
          new_start_at: addMinutesToIso(selectedItem.start_at, 30),
          new_end_at: addMinutesToIso(selectedItem.end_at, 30),
        },
      ];
    }

    if (selectedItem && matchesAny(lower, ["earlier", "提前", "往前", "早一点", "前移"])) {
      return [
        {
          command_id: createId("cmd"),
          action: "move_item",
          item_id: selectedItem.id,
          day_date: day.date,
          reason: input.utterance,
          new_start_at: addMinutesToIso(selectedItem.start_at, -30),
          new_end_at: addMinutesToIso(selectedItem.end_at, -30),
        },
      ];
    }

    if (matchesAny(lower, ["replace", "swap", "换", "替换"]) && matchesAny(lower, ["dinner", "晚餐"])) {
      const dinner = findMeal(input.trip, day.date, "dinner");
      if (!dinner) {
        throw new PlannerError("invalid_command", "No dinner item found to replace.");
      }

      return [
        {
          command_id: createId("cmd"),
          action: "replace_place",
          item_id: dinner.id,
          reason: input.utterance,
          place_query: buildDinnerQuery(lower),
          constraints: {
            near_place_id: dinner.place_id,
            min_rating: lower.includes("评分高") || lower.includes("higher") ? 4.5 : undefined,
            max_price_level: 4,
          },
        },
      ];
    }

    if (matchesAny(lower, ["lunch", "午饭", "午餐"]) && matchesAny(lower, ["add", "安排", "补"])) {
      return [
        {
          command_id: createId("cmd"),
          action: "fill_meal",
          day_date: day.date,
          reason: input.utterance,
          place_query: "lunch near museum",
          constraints: {
            near_place_id: findNearbyAnchor(input.trip, day.date),
            min_rating: 4.2,
          },
          payload: {
            meal_type: "lunch",
          },
        },
      ];
    }

    if (matchesAny(lower, ["relax", "太赶", "轻松", "放松"])) {
      return [
        {
          command_id: createId("cmd"),
          action: "relax_day",
          day_date: day.date,
          reason: input.utterance,
        },
      ];
    }

    if (matchesAny(lower, ["reoptimize", "optimize", "优化"])) {
      return [
        {
          command_id: createId("cmd"),
          action: "optimize_day",
          day_date: day.date,
          reason: input.utterance,
        },
      ];
    }

    if (matchesAny(lower, ["taxi", "打车"]) && matchesAny(lower, ["walk", "步行"])) {
      const threshold = extractThreshold(lower) ?? 20;
      const routes = input.trip.routes.filter(
        (route) => route.mode === "walk" && route.duration_minutes > threshold
      );

      if (routes.length === 0) {
        throw new PlannerError("invalid_command", "No walking segments exceed the requested threshold.");
      }

      return routes.map((route) => ({
        command_id: createId("cmd"),
        action: "set_transport_mode",
        reason: input.utterance,
        item_id: route.from_item_id,
        target_item_id: route.to_item_id,
        mode: "taxi",
      }));
    }

    throw new PlannerError("invalid_command", "Rule-based translator could not map the request to a command.");
  }
}

function inferTargetDay(trip: Itinerary, utterance: string, selectedDay?: string) {
  if (utterance.includes("day 3") || utterance.includes("第三天")) {
    return trip.days[2] ?? trip.days[0];
  }
  if (utterance.includes("day 2") || utterance.includes("第二天")) {
    return trip.days[1] ?? trip.days[0];
  }
  return trip.days.find((day) => day.date === selectedDay) ?? trip.days[0];
}

function findMeal(trip: Itinerary, dayDate: string, category: string) {
  const day = trip.days.find((candidate) => candidate.date === dayDate);
  return day?.items.find((item) => item.kind === "meal" && item.category === category);
}

function findNearbyAnchor(trip: Itinerary, dayDate: string): string | undefined {
  const day = trip.days.find((candidate) => candidate.date === dayDate);
  return day?.items.find((item) => item.kind === "activity" && item.place_id)?.place_id;
}

function buildDinnerQuery(utterance: string): string {
  const hasAmerican = utterance.includes("american") || utterance.includes("美式");
  const hasDowntown = utterance.includes("downtown") || utterance.includes("市中心");
  return [hasAmerican ? "american restaurant" : "restaurant", hasDowntown ? "downtown" : ""]
    .filter(Boolean)
    .join(" ");
}

function matchesAny(value: string, tokens: string[]): boolean {
  return tokens.some((token) => value.includes(token));
}

function extractThreshold(value: string): number | null {
  const match = value.match(/(\d{1,2})/);
  return match ? Number.parseInt(match[1], 10) : null;
}
