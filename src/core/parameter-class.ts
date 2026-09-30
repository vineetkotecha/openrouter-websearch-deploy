// Specifications remain functional even when expressed as a soft preference.
// Choice style/brand familiarity remain psychological; no values are inferred here.
export const physicalProperty=(key:string)=>/(?:screen|display|battery|storage|ram|memory|budget|price|performance|operating_system|os_preference|gpu|graphics|cpu|processor|microphone|sound_quality|portability|comfort_level|build_quality|keyboard|upgradeability|gaming_capability|ports_needed|noise_level)/.test(key);
