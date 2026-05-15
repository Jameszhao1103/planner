import type {
  ItineraryPace,
  TripImportedDayDraft,
  TripImportedItemDraft,
  TripImportedItineraryDraft,
  TripIntakeDraft,
  TripIntakeParseResult,
  TripIntakeParser,
} from "./types.ts";

type DestinationHint = {
  label: string;
  timezone: string;
  patterns: RegExp[];
};

const DESTINATION_HINTS: DestinationHint[] = [
  { label: "Jackson", timezone: "America/Denver", patterns: [/\bjackson\b/iu, /杰克逊/iu] },
  { label: "Grand Teton", timezone: "America/Denver", patterns: [/\bgrand teton\b/iu, /大提顿/iu] },
  { label: "Yellowstone", timezone: "America/Denver", patterns: [/\byellowstone\b/iu, /黄石/iu] },
  { label: "Tokyo", timezone: "Asia/Tokyo", patterns: [/\btokyo\b/iu, /东京/iu] },
  { label: "Kyoto", timezone: "Asia/Tokyo", patterns: [/\bkyoto\b/iu, /京都/iu] },
  { label: "Osaka", timezone: "Asia/Tokyo", patterns: [/\bosaka\b/iu, /大阪/iu] },
  { label: "Shanghai", timezone: "Asia/Shanghai", patterns: [/\bshanghai\b/iu, /上海/iu] },
  { label: "Beijing", timezone: "Asia/Shanghai", patterns: [/\bbeijing\b/iu, /北京/iu] },
  { label: "London", timezone: "Europe/London", patterns: [/\blondon\b/iu, /伦敦/iu] },
  { label: "Paris", timezone: "Europe/Paris", patterns: [/\bparis\b/iu, /巴黎/iu] },
  { label: "Chicago", timezone: "America/Chicago", patterns: [/\bchicago\b/iu, /芝加哥/iu] },
  { label: "Denver", timezone: "America/Denver", patterns: [/\bdenver\b/iu, /丹佛/iu] },
  {
    label: "Los Angeles",
    timezone: "America/Los_Angeles",
    patterns: [/\blos angeles\b/iu, /\bla\b/iu, /洛杉矶/iu],
  },
  {
    label: "San Francisco",
    timezone: "America/Los_Angeles",
    patterns: [/\bsan francisco\b/iu, /\bsf\b/iu, /旧金山/iu],
  },
  {
    label: "New York",
    timezone: "America/New_York",
    patterns: [/\bnew york\b/iu, /\bnyc\b/iu, /纽约/iu],
  },
  { label: "Asheville", timezone: "America/New_York", patterns: [/\basheville\b/iu] },
];

const DATE_RANGE_PATTERNS = [
  /(?:from|between|travel(?:ing)?|trip|dates?)\s*(?<start>\d{4}[-/]\d{1,2}[-/]\d{1,2})\s*(?:to|through|until|[-–~]|至|到)\s*(?<end>\d{4}[-/]\d{1,2}[-/]\d{1,2})/iu,
  /(?:从|出发)\s*(?<start>\d{4}[-/]\d{1,2}[-/]\d{1,2})\s*(?:到|至|[-–~])\s*(?<end>\d{4}[-/]\d{1,2}[-/]\d{1,2})/iu,
  /(?<start>\d{4}年\d{1,2}月\d{1,2}日)\s*(?:到|至|[-–~])\s*(?<end>\d{4}年\d{1,2}月\d{1,2}日)/iu,
  /(?:start|depart|arrival|check-?in|开始|出发日期)[^\d]*(?<start>\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日).*?(?:end|return|checkout|check-?out|结束|返程日期)[^\d]*(?<end>\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日)/isu,
];

const IANA_TIME_ZONE_PATTERN = /\b(?:America|Europe|Asia|Africa|Pacific|Atlantic|Australia)\/[A-Za-z_]+(?:\/[A-Za-z_]+)?\b/u;

export class RuleBasedTripIntakeParser implements TripIntakeParser {
  async parse(input: {
    sourceText: string;
    clarificationText?: string | null;
    knownDraft?: TripIntakeDraft | null;
    knownItinerary?: TripImportedItineraryDraft | null;
    now?: Date;
  }): Promise<TripIntakeParseResult> {
    const sourceText = input.sourceText.trim();
    const clarificationText = input.clarificationText?.trim() ?? "";
    const combinedText = clarificationText
      ? `${sourceText}\n\nLatest clarification:\n${clarificationText}`
      : sourceText;
    const normalizedText = normalizeText(combinedText);
    const destinations = inferDestinations(combinedText);
    const dateRange = extractDateRange(combinedText);
    const anchoredDates = extractAnchoredDates(combinedText);
    const durationDays = extractDurationDays(normalizedText);
    const travelerCount = extractTravelerCount(normalizedText);
    const timezone =
      extractExplicitTimeZone(combinedText)
      ?? inferTimeZone(destinations)
      ?? input.knownDraft?.timezone
      ?? null;
    const title = inferTitle(combinedText, destinations, durationDays) ?? input.knownDraft?.title ?? null;
    const itineraryDraft = buildRuleBasedItineraryDraft(combinedText, durationDays);
    const itinerary = itineraryDraft.days?.length ? itineraryDraft : (input.knownItinerary ?? itineraryDraft);
    const startDate = dateRange.start_date ?? anchoredDates.start_date ?? input.knownDraft?.start_date ?? null;
    const endDate = dateRange.end_date ?? anchoredDates.end_date ?? input.knownDraft?.end_date ?? null;
    const warnings: string[] = [];

    if (!startDate && durationDays) {
      warnings.push("Found trip length but not an exact start date.");
    }

    if (!(travelerCount ?? input.knownDraft?.traveler_count)) {
      warnings.push("Traveler count was not specified.");
    }

    if (!timezone && destinations.length > 0) {
      warnings.push("Destination was recognized, but timezone stayed ambiguous.");
    }

    return {
      draft: {
        title,
        start_date: startDate,
        end_date: endDate,
        timezone,
        traveler_count: travelerCount ?? input.knownDraft?.traveler_count ?? null,
      },
      derived: {
        duration_days: durationDays,
      },
      itinerary,
      summary: buildSummary({
        title,
        startDate,
        endDate,
        timezone,
        travelerCount: travelerCount ?? input.knownDraft?.traveler_count ?? null,
        durationDays,
        destinations,
      }),
      warnings,
    };
  }
}

function inferDestinations(sourceText: string): DestinationHint[] {
  return DESTINATION_HINTS.filter((hint) => hint.patterns.some((pattern) => pattern.test(sourceText)));
}

function inferTimeZone(destinations: DestinationHint[]): string | null {
  const timezones = Array.from(new Set(destinations.map((destination) => destination.timezone)));
  return timezones.length === 1 ? timezones[0] : null;
}

function extractExplicitTimeZone(sourceText: string): string | null {
  const match = sourceText.match(IANA_TIME_ZONE_PATTERN);
  return match?.[0] ?? null;
}

function extractDateRange(sourceText: string): {
  start_date: string | null;
  end_date: string | null;
} {
  for (const pattern of DATE_RANGE_PATTERNS) {
    const match = pattern.exec(sourceText);
    const startDate = normalizeDateToken(match?.groups?.start ?? "");
    const endDate = normalizeDateToken(match?.groups?.end ?? "");
    if (startDate && endDate) {
      return {
        start_date: startDate,
        end_date: endDate,
      };
    }
  }

  return {
    start_date: null,
    end_date: null,
  };
}

function extractAnchoredDates(sourceText: string): {
  start_date: string | null;
  end_date: string | null;
} {
  const patterns = [
    {
      field: "start_date" as const,
      pattern:
        /(?:start(?:\s+date)?|depart(?:ure)?(?:\s+date)?|arrival(?:\s+date)?|trip starts?|出发日期|开始日期|开始时间|抵达日期|到达日期)[^\d]*(?<date>\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日)/iu,
    },
    {
      field: "end_date" as const,
      pattern:
        /(?:end(?:\s+date)?|return(?:\s+date)?|checkout(?:\s+date)?|trip ends?|返程日期|结束日期|离开日期)[^\d]*(?<date>\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日)/iu,
    },
  ];

  const result = {
    start_date: null,
    end_date: null,
  };

  patterns.forEach(({ field, pattern }) => {
    const match = pattern.exec(sourceText);
    const normalized = normalizeDateToken(match?.groups?.date ?? "");
    if (normalized) {
      result[field] = normalized;
    }
  });

  return result;
}

function normalizeDateToken(value: string): string | null {
  const token = value.trim();
  if (!token) {
    return null;
  }

  const isoMatch = token.match(/^(?<year>\d{4})[-/](?<month>\d{1,2})[-/](?<day>\d{1,2})$/u);
  if (isoMatch?.groups) {
    return formatDateParts(isoMatch.groups.year, isoMatch.groups.month, isoMatch.groups.day);
  }

  const zhMatch = token.match(/^(?<year>\d{4})年(?<month>\d{1,2})月(?<day>\d{1,2})日$/u);
  if (zhMatch?.groups) {
    return formatDateParts(zhMatch.groups.year, zhMatch.groups.month, zhMatch.groups.day);
  }

  return null;
}

function formatDateParts(year: string, month: string, day: string): string | null {
  const normalized = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function extractDurationDays(normalizedText: string): number | null {
  const numericMatch = normalizedText.match(/\b(?<count>\d{1,2})\s*(?:day|days|晚|night|nights|天)\b/iu);
  if (numericMatch?.groups?.count) {
    const count = Number.parseInt(numericMatch.groups.count, 10);
    if (Number.isFinite(count) && count > 0) {
      return count;
    }
  }

  const zhMatch = normalizedText.match(/(?<count>[一二三四五六七八九十两俩\d]{1,3})\s*天/u);
  if (zhMatch?.groups?.count) {
    return parseLooseCount(zhMatch.groups.count);
  }

  return null;
}

function extractTravelerCount(normalizedText: string): number | null {
  const familyMatch = normalizedText.match(/一家(?<count>[一二三四五六七八九十两俩\d]{1,3})口/u);
  if (familyMatch?.groups?.count) {
    return parseLooseCount(familyMatch.groups.count);
  }

  const genericMatch = normalizedText.match(
    /(?<count>[一二三四五六七八九十两俩\d]{1,3})\s*(?:位|名)?\s*(?:traveler|travelers|traveller|travellers|people|person|adults?|人)\b/iu
  );
  if (genericMatch?.groups?.count) {
    return parseLooseCount(genericMatch.groups.count);
  }

  return null;
}

function parseLooseCount(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const numeric = Number.parseInt(trimmed, 10);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }

  const mapping = new Map([
    ["一", 1],
    ["二", 2],
    ["两", 2],
    ["俩", 2],
    ["三", 3],
    ["四", 4],
    ["五", 5],
    ["六", 6],
    ["七", 7],
    ["八", 8],
    ["九", 9],
    ["十", 10],
  ]);

  if (trimmed.length === 1) {
    return mapping.get(trimmed) ?? null;
  }

  if (trimmed === "十一") return 11;
  if (trimmed === "十二") return 12;
  return null;
}

function inferTitle(sourceText: string, destinations: DestinationHint[], durationDays: number | null): string | null {
  const cleanedFirstLine = sourceText
    .split(/\r?\n/u)
    .map((line) => line.replace(/!\[[^\]]*\]\([^)]+\)/gu, "").trim())
    .find((line) => line && line.length <= 80 && !/^(可以|sure|yes|day\s*\d+)/iu.test(line));

  if (cleanedFirstLine && looksLikeTitle(cleanedFirstLine)) {
    return cleanedFirstLine;
  }

  const prefixCandidate = cleanedFirstLine
    ?.split(/\bfrom\b|\bto\b|\bin\b|\bfor\b|，|,|：|:/iu)[0]
    ?.trim();
  if (prefixCandidate && looksLikeTitle(prefixCandidate)) {
    return prefixCandidate;
  }

  const destinationLabels = destinations.map((destination) => destination.label);
  if (destinationLabels.length === 0) {
    return durationDays ? `${durationDays}-Day Trip` : null;
  }

  if (destinationLabels.length === 1) {
    return `${destinationLabels[0]} Trip`;
  }

  const lead = destinationLabels.slice(0, 3);
  return `${lead.slice(0, -1).join(", ")} & ${lead.at(-1)}`;
}

function looksLikeTitle(value: string): boolean {
  if (value.length < 6) {
    return false;
  }

  if (/[。！？]/u.test(value) || /\d{4}-\d{2}-\d{2}/u.test(value)) {
    return false;
  }

  return /[\p{L}\p{N}]/u.test(value);
}

function buildSummary(input: {
  title: string | null;
  startDate: string | null;
  endDate: string | null;
  timezone: string | null;
  travelerCount: number | null;
  durationDays: number | null;
  destinations: DestinationHint[];
}): string {
  const fragments: string[] = [];
  if (input.title) {
    fragments.push(input.title);
  } else if (input.destinations.length > 0) {
    fragments.push(input.destinations.map((destination) => destination.label).join(" / "));
  } else {
    fragments.push("Trip plan");
  }

  if (input.startDate && input.endDate) {
    fragments.push(`${input.startDate} to ${input.endDate}`);
  } else if (input.durationDays) {
    fragments.push(`${input.durationDays} days`);
  }

  if (input.timezone) {
    fragments.push(input.timezone);
  }

  if (input.travelerCount) {
    fragments.push(`${input.travelerCount} travelers`);
  }

  return `Parsed ${fragments.join(" · ")}.`;
}

function buildRuleBasedItineraryDraft(
  sourceText: string,
  durationDays: number | null
): TripImportedItineraryDraft {
  const daySections = extractDaySections(sourceText);
  const days = daySections.length > 0
    ? daySections.map((section, index) => buildDayDraftFromSection(section, index))
    : buildFallbackDaysFromText(sourceText, durationDays);

  return {
    pace: inferPace(sourceText),
    days,
  };
}

function extractDaySections(sourceText: string): Array<{
  dayIndex: number | null;
  heading: string;
  body: string;
}> {
  const sections: Array<{
    dayIndex: number | null;
    heading: string;
    body: string;
  }> = [];
  const pattern = /^(?:#{1,6}\s*)?day\s*(?<index>\d+)\s*[|｜:：\-–—]?\s*(?<heading>.+)$/gimu;
  const matches = Array.from(sourceText.matchAll(pattern));
  if (matches.length === 0) {
    return sections;
  }

  matches.forEach((match, index) => {
    const start = match.index ?? 0;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? sourceText.length) : sourceText.length;
    sections.push({
      dayIndex: match.groups?.index ? Number.parseInt(match.groups.index, 10) : null,
      heading: (match.groups?.heading ?? "").trim(),
      body: sourceText.slice(start + match[0].length, end).trim(),
    });
  });

  return sections;
}

function buildDayDraftFromSection(
  section: {
    dayIndex: number | null;
    heading: string;
    body: string;
  },
  index: number
): TripImportedDayDraft {
  const routeStops = extractRouteStops(section.body);
  const items = routeStops.length > 0
    ? routeStops.map((stop, stopIndex) => buildActivityItem(stop, stopIndex))
    : extractItemsFromHeading(section.heading);

  return {
    day_index: section.dayIndex ?? index + 1,
    label: `Day ${section.dayIndex ?? index + 1}`,
    summary: section.heading || summarizeBody(section.body),
    items,
  };
}

function buildFallbackDaysFromText(sourceText: string, durationDays: number | null): TripImportedDayDraft[] {
  const sentenceItems = extractSentenceHighlights(sourceText).slice(0, 6);
  if (sentenceItems.length === 0) {
    return [];
  }

  if (!durationDays || durationDays <= 1) {
    return [
      {
        day_index: 1,
        label: "Day 1",
        summary: summarizeBody(sourceText),
        items: sentenceItems.map((title, index) => buildActivityItem(title, index)),
      },
    ];
  }

  return Array.from({ length: durationDays }, (_, index) => ({
    day_index: index + 1,
    label: `Day ${index + 1}`,
    summary: index < sentenceItems.length ? sentenceItems[index] : null,
    items: index < sentenceItems.length ? [buildActivityItem(sentenceItems[index], 0)] : [],
  }));
}

function extractRouteStops(body: string): string[] {
  const boldLineMatch = body.match(/\*\*(?<route>[^*]+(?:→|->|➜|至|到)[^*]+)\*\*/u);
  if (boldLineMatch?.groups?.route) {
    return boldLineMatch.groups.route
      .split(/(?:→|->|➜|至|到)/u)
      .map((part) => cleanupStop(part))
      .filter(Boolean);
  }

  return [];
}

function extractItemsFromHeading(heading: string): TripImportedItemDraft[] {
  return heading
    .split(/[+＋/]/u)
    .map((part) => cleanupStop(part))
    .filter(Boolean)
    .map((title, index) => buildActivityItem(title, index));
}

function extractSentenceHighlights(sourceText: string): string[] {
  return sourceText
    .split(/[。.!?\n]/u)
    .map((sentence) => cleanupStop(sentence))
    .filter((sentence) => sentence.length >= 6)
    .slice(0, 8);
}

function buildActivityItem(title: string, index: number): TripImportedItemDraft {
  const slot = defaultTimeSlot(index);
  return {
    title,
    kind: inferItemKindFromTitle(title),
    category: inferItemCategoryFromTitle(title),
    start_time: slot.start,
    end_time: slot.end,
    duration_minutes: slot.duration,
    status: inferItemKindFromTitle(title) === "flight" ? "confirmed" : "suggested",
    locked: inferItemKindFromTitle(title) === "flight",
    tags: [],
  };
}

function defaultTimeSlot(index: number) {
  const presets = [
    { start: "09:00", end: "10:30", duration: 90 },
    { start: "11:00", end: "12:30", duration: 90 },
    { start: "13:30", end: "15:00", duration: 90 },
    { start: "15:30", end: "17:00", duration: 90 },
    { start: "18:00", end: "19:30", duration: 90 },
  ];

  return presets[index] ?? {
    start: "19:30",
    end: "21:00",
    duration: 90,
  };
}

function inferItemKindFromTitle(title: string): string {
  const normalized = title.toLowerCase();
  if (/(arrive|arrival|flight|airport|落地|到达|飞)/u.test(normalized)) return "flight";
  if (/(check[\s-]?in|入住)/u.test(normalized)) return "check_in";
  if (/(check[\s-]?out|退房)/u.test(normalized)) return "check_out";
  if (/(lunch|dinner|breakfast|brunch|晚餐|午餐|早餐)/u.test(normalized)) return "meal";
  if (/(drive|transit|transfer|返程|回程|进入|离开)/u.test(normalized)) return "transit";
  return "activity";
}

function inferItemCategoryFromTitle(title: string): string {
  const normalized = title.toLowerCase();
  if (/(lunch|午餐)/u.test(normalized)) return "lunch";
  if (/(dinner|晚餐)/u.test(normalized)) return "dinner";
  if (/(breakfast|brunch|早餐)/u.test(normalized)) return "breakfast";
  return inferItemKindFromTitle(title);
}

function inferPace(sourceText: string): ItineraryPace | null {
  if (/(轻松|relaxed|easygoing)/iu.test(sourceText)) return "relaxed";
  if (/(赶|packed|intense)/iu.test(sourceText)) return "packed";
  return "balanced";
}

function summarizeBody(body: string): string | null {
  const sentence = body
    .split(/[。.!?\n]/u)
    .map((part) => cleanupStop(part))
    .find((part) => part.length >= 6);
  return sentence ?? null;
}

function cleanupStop(value: string): string {
  return value
    .replace(/\[[^\]]+\]\([^)]+\)/gu, "")
    .replace(/[*_`#>-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/:-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}
