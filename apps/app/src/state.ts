import { atomWithStorage } from "jotai/utils";

export const channelNameState = atomWithStorage("channelName", "");

export const availablePrompts: {
  icon: string;
  name: "Superhero" | "Supervillain" | "Sports Star" | "Custom";
  initialMessage: string;
  promptText: string;
}[] = [
  {
    icon: "🦸",
    name: "Superhero",
    initialMessage: "You're my hero.",
    promptText: `I want you to imagine what kind of superhero they would be. Describe them and their superpowers, and origin story while making sure to mention their name.`,
  },
  {
    icon: "🦹",
    name: "Supervillain",
    initialMessage: "It's not easy being evil.",
    promptText:
      "I want you to imagine what kind of supervillain they would be. Describe them and their superpowers, and origin story while making sure to mention their name.",
  },
  {
    icon: "🏅",
    name: "Sports Star",
    initialMessage: "We are in the presence of greatness.",
    promptText:
      "Imagine the user as a Sports Star. Decide what sport they play. Also describe their greatest play for that sport and create any other milestones that make sense. Try to avoid common sports like basketball or soccer. The more obscure the sport the better.",
  },
  { icon: "⚙️", name: "Custom", initialMessage: "", promptText: "" },
];

export const selectedPromptState = atomWithStorage(
  "selectedPrompt",
  availablePrompts[0]
);
export const customInitialMessageState = atomWithStorage(
  "customInitialMessage",
  ""
);
export const customPromptState = atomWithStorage("customPrompt", "");

export const selectedGenerativeProviderState = atomWithStorage(
  "selectedGenerativeProvider",
  ""
);
export const selectedGenerativeModelState = atomWithStorage(
  "selectedGenerativeModel",
  ""
);
export const selectedVoiceProviderState = atomWithStorage(
  "selectedVoiceProvider",
  ""
);
export const selectedVoiceState = atomWithStorage("selectedVoice", "");

export const shouldTriggerBitsState = atomWithStorage(
  "shouldTriggerBits",
  true
);
export const minBitsState = atomWithStorage("minBits", 100);

export const shouldTriggerSubsState = atomWithStorage(
  "shouldTriggerSubs",
  false
);

export const shouldTriggerGiftsState = atomWithStorage(
  "shouldTriggerGifts",
  false
);

export const shouldTriggerRaidsState = atomWithStorage(
  "shouldTriggerRaids",
  false
);
export const minRaidersState = atomWithStorage("minRaiders", 10);
