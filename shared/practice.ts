/** Public, optional lesson metadata. Presence does not advertise runner support. */
export type PracticeSchema =
  | { type: "boolean" | "string" | "integer" | "number" }
  | { type: "array"; items: PracticeSchema }
  | { type: "object"; properties: Record<string, PracticeSchema>; required: string[] };

export type PracticeValue = boolean | string | number | PracticeValue[] | { [name: string]: PracticeValue };
export type PracticeCase = { id: string; name: string; inputs: Record<string, PracticeValue>; expected?: PracticeValue };
export type Practice = {
  version: 1;
  entry: { file: string; symbol: string };
  inputs: { name: string; schema: PracticeSchema }[];
  output: PracticeSchema;
  cases: PracticeCase[];
};
