import { useEffect, useRef, useState } from "react";
import {
  Input,
  Flex,
  Text,
  PasswordInput,
  Checkbox,
  Accordion,
  Button,
  Select,
  Textarea,
  SelectProps,
  Group,
} from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import { useAtom } from "jotai";
import debounce from "lodash.debounce";

import "./App.css";
import tmi from "tmi.js";
import {
  channelNameState,
  shouldTriggerBitsState,
  minBitsState,
  shouldTriggerGiftsState,
  shouldTriggerSubsState,
  shouldTriggerRaidsState,
  minRaidersState,
  selectedPromptState,
  customPromptState,
  availablePrompts,
  customInitialMessageState,
  selectedGenerativeProviderState,
  selectedGenerativeModelState,
  selectedVoiceProviderState,
  selectedVoiceState,
} from "./state";

// definitely not the right port
const apiBaseUrl = import.meta.env.API_URL || "http://localhost:3000";

interface ProvidersResponse {
  voice: string[];
  generative: string[];
}

export interface GenerativeModel {
  id: string;
  name: string;
}

export interface Voice {
  id: string;
  name: string;
  gender?: "male" | "female" | string;
  language?: string;
  accent?: string;
}

const userCache: Record<string, number> = {};

// function sendMessageToVapi(vapi: Vapi, username?: string) {
//   if (username) {
//     vapi.send({
//       type: "add-message",
//       message: {
//         role: "user",
//         content: `The username is ${username}`,
//       },
//     });
//   }
// }

const userCacheTTL = 60 * 1000;

// uses global state for simplicity for now
async function initiateVapiResponse(
  channel: string,
  username: string,
  usedBits: number,
  minBits: number,
  userQueue: { current: string[] }
) {
  if (minBits < 1) {
    console.log("Min Bits must be greater than or equal to 1.");
    return;
  }

  if (usedBits >= minBits) {
    try {
      // user caching to prevent messages too often. maybe temporary
      if (
        userCache[username] &&
        Date.now() < userCache[username] + userCacheTTL
      ) {
        console.log("User is still in cache:", username);
        return;
      } else {
        userCache[username] = Date.now();
      }

      if (userQueue.current.length < 1) {
        // await vapiInstance.start(vapiAssistantId);
      }

      userQueue.current.push(username);
      console.log("pushed to queue", userQueue.current);
    } catch (e: unknown) {
      console.log("Error starting assistant or sending message.", e);
    }
  }
}

function handleSpeechEnd(
  queue: { current: string[] },
  isSpeaking: { current: boolean }
) {
  if (isSpeaking.current) {
    console.log("Still speaking, bailing out of speech end");
    return;
  }

  console.log("queue after shift: ", queue.current);

  const username = queue.current.shift();

  console.log("queue after shift: ", queue.current);

  if (username) {
    // sendMessageToVapi(vapi, username);
  } else {
    // is this the right place?
    // vapi.stop();
  }
}

// const speechEndHandler = debounce(handleSpeechEnd, 5000);

function App() {
  const [channelName, setChannelName] = useAtom(channelNameState);
  const [selectedPrompt, setSelectedPrompt] = useAtom(selectedPromptState);
  const [customPrompt, setCustomPrompt] = useAtom(customPromptState);
  const [customInitialMessage, setCustomInitialMessage] = useAtom(
    customInitialMessageState
  );

  const [selectedGenerativeProvider, setSelectedGenerativeProvider] = useAtom(
    selectedGenerativeProviderState
  );
  const [selectedGenerativeModel, setSelectedGenerativeModel] = useAtom(
    selectedGenerativeModelState
  );
  const [selectedVoiceProvider, setSelectedVoiceProvider] = useAtom(
    selectedVoiceProviderState
  );
  const [selectedVoice, setSelectedVoice] = useAtom(selectedVoiceState);

  const [shouldTriggerBits, setShouldTriggerBits] = useAtom(
    shouldTriggerBitsState
  );
  const [minBits, setMinBits] = useAtom(minBitsState);
  const [shouldTriggerSubs, setShouldTriggerSubs] = useAtom(
    shouldTriggerSubsState
  );
  const [shouldTriggerGifts, setShouldTriggerGifts] = useAtom(
    shouldTriggerGiftsState
  );

  const [shouldTriggerRaids, setShouldTriggerRaids] = useAtom(
    shouldTriggerRaidsState
  );
  const [minRaiders, setMinRaiders] = useAtom(minRaidersState);

  const [isDebugging, setIsDebugging] = useState(false);
  const [manualUsername, setManualUsername] = useState("");
  const [availableProviders, setAvailableProviders] =
    useState<ProvidersResponse>({ generative: [], voice: [] });
  const [availableModels, setAvailableModels] = useState<
    Record<string, GenerativeModel[]>
  >({});
  const [availableVoices, setAvailableVoices] = useState<
    Record<string, Voice[]>
  >({});
  const userQueue = useRef<string[]>([]);

  const isSpeaking = useRef(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    async function getProvidersAndModels() {
      const providersRequest = fetch(`${apiBaseUrl}/providers`)
        .then((res) => {
          return res.json();
        })
        .catch(() => {
          return {
            generative: ["Failed to fetch Generative Providers"],
            voice: ["Failed to fetch Voice Providers"],
          };
        });

      const modelsRequest = fetch(`${apiBaseUrl}/models`)
        .then((res) => {
          return res.json();
        })
        .catch(() => {
          return [{ id: "", name: "Failed to fetch Models" }];
        });

      const voicesRequest = fetch(`${apiBaseUrl}/voices`)
        .then((res) => {
          return res.json();
        })
        .catch(() => {
          return [
            {
              id: "",
              name: "",
            },
          ];
        });

      const [providers, models, voices] = await Promise.all([
        providersRequest,
        modelsRequest,
        voicesRequest,
      ]);

      setAvailableProviders(providers);
      setAvailableModels(models);
      setAvailableVoices(voices);
    }

    getProvidersAndModels();
  }, []);

  useEffect(() => {
    const client = new tmi.Client({
      // options: { debug: true },
      // identity: {
      //   username: 'bot_name',
      //   password: 'oauth:my_bot_token'
      // },
      channels: [channelName],
    });

    async function connectClient() {
      try {
        await client.connect();

        if (shouldTriggerBits) {
          client.on("cheer", async (channel, userstate, message) => {
            try {
              console.log("CHEER:", { channel, userstate, message });
              if (userstate?.bits && userstate.username) {
                const usedBits = parseInt(userstate?.bits || "0", 10);
                // await initiateVapiResponse(
                //   channelName,
                //   userstate.username,
                //   usedBits,
                //   minBits,
                //   vapiAssistantId,
                //   vapiPublicKey,
                //   userQueue,
                //   vapiInstance
                // );
              }
            } catch (e: unknown) {
              console.log("Error in CHEER:", e);
            }
          });
        }

        if (shouldTriggerGifts) {
          client.on(
            "subgift",
            async (
              channel,
              username,
              streakMonths,
              recipient,
              methods,
              userstate
            ) => {
              console.log("SUBGIFT", {
                channel,
                username,
                streakMonths,
                recipient,
                methods,
                userstate,
              });

              const giftedUsername: string =
                userstate["msg-param-recipient-display-name"] ??
                userstate["msg-param-recipient-user-name"] ??
                "";

              if (giftedUsername) {
                // await initiateVapiResponse(
                //   channelName,
                //   giftedUsername,
                //   minBits + 1,
                //   minBits,
                //   vapiAssistantId,
                //   vapiPublicKey,
                //   userQueue,
                //   vapiInstance
                // );
              }
            }
          );

          client.on(
            "submysterygift",
            async (channel, username, numbOfSubs, methods, userstate) => {
              console.log("SUBMYSTERYGIFT", {
                channel,
                username,
                numbOfSubs,
                methods,
                userstate,
              });

              const giftedUsername: string =
                userstate["msg-param-recipient-display-name"] ??
                userstate["msg-param-recipient-user-name"] ??
                "";

              if (giftedUsername) {
                // await initiateVapiResponse(
                //   channelName,
                //   giftedUsername,
                //   minBits + 1,
                //   minBits,
                //   vapiAssistantId,
                //   vapiPublicKey,
                //   userQueue,
                //   vapiInstance
                // );
              }
            }
          );
        }

        if (shouldTriggerSubs) {
          client.on(
            "subscription",
            async (channel, username, method, message, userstate) => {
              console.log("SUBSCRIPTION", {
                channel,
                username,
                method,
                message,
                userstate,
              });

              // await initiateVapiResponse(
              //   channelName,
              //   username,
              //   minBits + 1,
              //   minBits,
              //   vapiAssistantId,
              //   vapiPublicKey,
              //   userQueue,
              //   vapiInstance
              // );
            }
          );

          client.on(
            "resub",
            async (channel, username, method, message, userstate) => {
              console.log("RESUB", {
                channel,
                username,
                method,
                message,
                userstate,
              });

              // await initiateVapiResponse(
              //   channelName,
              //   username,
              //   minBits + 1,
              //   minBits,
              //   vapiAssistantId,
              //   vapiPublicKey,
              //   userQueue,
              //   vapiInstance
              // );
            }
          );
        }

        if (shouldTriggerRaids) {
          client.on("raided", async (channel, username, viewers) => {
            console.log("RAIDED", {
              channel,
              username,
              viewers,
            });

            if (viewers >= minRaiders) {
              setTimeout(() => {
                // initiateVapiResponse(
                //   channelName,
                //   username,
                //   minBits + 1,
                //   minBits,
                //   vapiAssistantId,
                //   vapiPublicKey,
                //   userQueue,
                //   vapiInstance
                // );
              }, 10000);
            }
          });
        }

        // TODO: remove this?
        if (isDebugging) {
          client.on("message", async (channel, userstate, message) => {
            try {
              console.log("MESSAGE:", { channel, userstate, message });

              if (
                userstate.username &&
                !!userstate.subscriber
                //  && userstate.username === "cmgriffing"
              ) {
                const usedBits = 100;
                // await initiateVapiResponse(
                //   channelName,
                //   userstate.username,
                //   usedBits,
                //   minBits,
                //   vapiAssistantId,
                //   vapiPublicKey,
                //   userQueue,
                //   vapiInstance
                // );
              }
            } catch (e: unknown) {
              console.log("Error in MESSAGE:", e);
            }
          });
        }
      } catch (e: unknown) {
        console.log("Error connecting with TMI:", e);
      }
    }

    connectClient();

    return () => {
      const readyState = client.readyState();
      if (readyState === "OPEN" || readyState === "CONNECTING") {
        client.disconnect();
      }
    };
  }, [
    channelName,
    isDebugging,
    shouldTriggerBits,
    minBits,
    shouldTriggerGifts,
    shouldTriggerSubs,
    shouldTriggerRaids,
    minRaiders,
  ]);

  return (
    <>
      <Flex w={"100%"} direction="column">
        <Text size="xl" fw={700} ta="center">
          🔊 Twitch Voice Rewards 🔊
        </Text>
        <Text ta="center">
          Reward your Twitch supporters with a Voice Assistant acknowledging
          them.
        </Text>

        <audio controls autoPlay ref={audioRef}></audio>
      </Flex>
      <Flex
        // direction="column"
        mih="100vh"
        miw="100vw"
        align={"flex-start"}
        justify={"center"}
        gap="2rem"
        wrap={"wrap"}
        p="2rem"
      >
        <Flex w={{ base: "100%", md: "30%" }} direction="column" gap="1rem">
          <Text fw={600} ta="left">
            Config
          </Text>
          <Flex direction="column" align={"flex-start"}>
            <label htmlFor="channel-name">Channel Name</label>
            <Input
              w="100%"
              id="channel-name"
              name="channel-name"
              value={channelName}
              onChange={(e) => {
                setChannelName(e.currentTarget.value);
              }}
            />
          </Flex>

          <Flex direction="column" align={"flex-start"}>
            <label htmlFor="selected-prompt">Selected Prompt</label>
            <Select
              w="100%"
              id="selected-prompt"
              name="selected-prompt"
              value={selectedPrompt.name}
              data={availablePrompts.map((prompt) => ({
                value: prompt.name,
                label: `${prompt.icon} ${prompt.name}`,
              }))}
              checkIconPosition="right"
              onChange={(newSelectedPrompt) => {
                if (!newSelectedPrompt) {
                  return;
                }
                const actualPrompt = availablePrompts.find(
                  (prompt) => prompt.name === newSelectedPrompt
                );
                if (!actualPrompt) {
                  return;
                }
                setSelectedPrompt(actualPrompt);
              }}
              renderOption={({ option, checked }) => (
                <Group flex="1" gap="xs">
                  <Text fw={checked ? 600 : 400}>{option.label}</Text>
                  {checked && (
                    <IconCheck style={{ marginInlineStart: "auto" }} />
                  )}
                </Group>
              )}
            ></Select>
          </Flex>

          {selectedPrompt.name !== "Custom" && (
            <>
              <Flex direction="column" align={"flex-start"}>
                <Text fw={"bold"}>Preset Prompt Text</Text>
                <p>When I tell you a username, {selectedPrompt.promptText}</p>
              </Flex>
            </>
          )}

          {selectedPrompt.name === "Custom" && (
            <>
              <Flex direction="column" align={"flex-start"}>
                <label htmlFor="custom-initial-message">Initial Message</label>
                <Input
                  w="100%"
                  id="custom-initial-message"
                  name="custom-initial-message"
                  value={customInitialMessage}
                  onChange={(e) => {
                    setCustomInitialMessage(e.currentTarget.value);
                  }}
                  required
                />
              </Flex>

              <Flex direction="column" align={"flex-start"}>
                <label htmlFor="custom-prompt">Prompt</label>
                <Textarea
                  w="100%"
                  rows={4}
                  id="custom-prompt"
                  name="custom-prompt"
                  value={customPrompt}
                  onChange={(e) => {
                    setCustomPrompt(e.currentTarget.value);
                  }}
                  required
                />
              </Flex>
            </>
          )}
        </Flex>

        <Flex w={{ base: "100%", md: "30%" }} direction="column" gap="1rem">
          <Flex direction="column" align={"flex-start"}>
            <label htmlFor="selected-generative-provider">
              Generative Provider
            </label>
            <Select
              w="100%"
              id="selected-generative-provider"
              name="selected-generative-provider"
              value={selectedGenerativeProvider}
              data={availableProviders.generative}
              checkIconPosition="right"
              onChange={(newSelectedProvider) => {
                if (!newSelectedProvider) {
                  return;
                }
                const actualProvider = availableProviders.generative.find(
                  (provider) => provider === newSelectedProvider
                );
                if (!actualProvider) {
                  return;
                }
                setSelectedGenerativeProvider(actualProvider);
              }}
              renderOption={({ option, checked }) => (
                <Group flex="1" gap="xs">
                  <Text fw={checked ? 600 : 400}>{option.label}</Text>
                  {checked && (
                    <IconCheck style={{ marginInlineStart: "auto" }} />
                  )}
                </Group>
              )}
            ></Select>
          </Flex>

          {Boolean(selectedGenerativeProvider) && (
            <Flex direction="column" align={"flex-start"}>
              <label htmlFor="selected-generative-model">
                Generative Model
              </label>
              <Select
                w="100%"
                id="selected-generative-model"
                name="selected-generative-model"
                value={selectedGenerativeModel}
                data={(availableModels[selectedGenerativeProvider] || []).map(
                  (model) => ({
                    label: model.name,
                    value: model.id,
                  })
                )}
                checkIconPosition="right"
                onChange={(newSelectedModel) => {
                  if (!newSelectedModel) {
                    return;
                  }
                  const actualModel = availableModels[
                    selectedGenerativeProvider
                  ].find((model) => model.id === newSelectedModel);
                  if (!actualModel) {
                    return;
                  }
                  setSelectedGenerativeModel(actualModel.id);
                }}
                renderOption={({ option, checked }) => (
                  <Group flex="1" gap="xs">
                    <Text fw={checked ? 600 : 400}>{option.label}</Text>
                    {checked && (
                      <IconCheck style={{ marginInlineStart: "auto" }} />
                    )}
                  </Group>
                )}
              ></Select>
            </Flex>
          )}

          {Boolean(selectedGenerativeModel) && (
            <Flex direction="column" align={"flex-start"}>
              <label htmlFor="selected-voice-provider">Voice Provider</label>
              <Select
                w="100%"
                id="selected-voice-provider"
                name="selected-voice-provider"
                value={selectedVoiceProvider}
                data={availableProviders.voice}
                checkIconPosition="right"
                onChange={(newSelectedVoiceProvider) => {
                  if (!newSelectedVoiceProvider) {
                    return;
                  }
                  const actualVoiceProvider = availableProviders.voice.find(
                    (provider) => provider === newSelectedVoiceProvider
                  );
                  if (!actualVoiceProvider) {
                    return;
                  }
                  setSelectedVoiceProvider(actualVoiceProvider);
                }}
                renderOption={({ option, checked }) => (
                  <Group flex="1" gap="xs">
                    <Text fw={checked ? 600 : 400}>{option.label}</Text>
                    {checked && (
                      <IconCheck style={{ marginInlineStart: "auto" }} />
                    )}
                  </Group>
                )}
              ></Select>
            </Flex>
          )}

          {Boolean(selectedVoiceProvider) && (
            <Flex direction="column" align={"flex-start"}>
              <label htmlFor="selected-voice">Voice Provider</label>
              <Select
                w="100%"
                id="selected-voice"
                name="selected-voice"
                value={selectedVoice}
                data={(availableVoices[selectedVoiceProvider] || []).map(
                  (model) => ({
                    label: model.name,
                    value: model.id,
                  })
                )}
                checkIconPosition="right"
                onChange={(newSelectedVoice) => {
                  if (!newSelectedVoice) {
                    return;
                  }
                  const actualVoice = availableVoices[
                    selectedVoiceProvider
                  ].find((voice) => voice.id === newSelectedVoice);
                  if (!actualVoice) {
                    return;
                  }
                  setSelectedVoice(actualVoice.id);
                }}
                renderOption={({ option, checked }) => (
                  <Group flex="1" gap="xs">
                    <Text fw={checked ? 600 : 400}>{option.label}</Text>
                    {checked && (
                      <IconCheck style={{ marginInlineStart: "auto" }} />
                    )}
                  </Group>
                )}
              ></Select>
            </Flex>
          )}
        </Flex>

        <Flex w={{ base: "100%", md: "30%" }} direction="column" gap="1rem">
          <Flex direction="column" align="flex-start" gap="1rem">
            <Text fw={600}>Triggers</Text>

            <Text>You must configure at least one trigger.</Text>

            <Flex direction="column" align={"flex-start"}>
              <Checkbox
                checked={isDebugging}
                label="Enable Debugging via regular messages"
                onChange={(e) => {
                  setIsDebugging(e.currentTarget.checked);
                }}
              />
            </Flex>

            <hr />

            <Flex direction="column" gap="1rem">
              <Checkbox
                label="Bits"
                checked={shouldTriggerBits}
                onChange={(e) => {
                  setShouldTriggerBits(e.currentTarget.checked);
                }}
              />
              {shouldTriggerBits && (
                <Flex direction="column" align={"flex-start"} pl="2rem">
                  <label htmlFor="min-bits">Minimum Bits</label>
                  <Input
                    w="100%"
                    min={1}
                    id="min-bits"
                    name="min-bits"
                    type="number"
                    value={minBits}
                    onChange={(e) => {
                      setMinBits(e.currentTarget.valueAsNumber);
                    }}
                  />
                </Flex>
              )}

              <Checkbox
                label="Subscriptions (includes Resubs)"
                checked={shouldTriggerSubs}
                onChange={(e) => {
                  setShouldTriggerSubs(e.currentTarget.checked);
                }}
              />

              <Checkbox
                label="Gifted Subscriptions (includes anonymous)"
                checked={shouldTriggerGifts}
                onChange={(e) => {
                  setShouldTriggerGifts(e.currentTarget.checked);
                }}
              />

              <Checkbox
                label="Raids"
                checked={shouldTriggerRaids}
                onChange={(e) => {
                  setShouldTriggerRaids(e.currentTarget.checked);
                }}
              />
              {shouldTriggerRaids && (
                <Flex direction="column" align={"flex-start"} pl="2rem">
                  <label htmlFor="min-raiders">Minimum Raiders</label>
                  <Input
                    w="100%"
                    min={1}
                    id="min-raiders"
                    name="min-raiders"
                    type="number"
                    value={minRaiders}
                    onChange={(e) => {
                      setMinRaiders(e.currentTarget.valueAsNumber);
                    }}
                  />
                </Flex>
              )}
            </Flex>
          </Flex>

          <Flex direction="column" bg={"#ffeeee"} p="1rem" gap="1rem">
            <form
              onSubmit={async (e) => {
                e.preventDefault();

                // await initiateVapiResponse(
                //   channelName,
                //   manualUsername,
                //   minBits + 1,
                //   minBits,
                //   vapiAssistantId,
                //   vapiPublicKey,
                //   userQueue,
                //   vapiInstance
                // );

                setManualUsername("");
              }}
            >
              <Text fw={600}>Manual Trigger</Text>
              <Text>
                Occasionally, the bot might make a mistake. If you would like to
                manually trigger an announcement, you can use this form by
                pasting the username yourself.
              </Text>
              <Flex direction="column" align={"flex-start"}>
                <label htmlFor="manual-username">Username</label>
                <Input
                  w="100%"
                  id="manual-username"
                  name="manual-username"
                  type="text"
                  value={manualUsername}
                  onChange={(e) => {
                    setManualUsername(e.currentTarget.value);
                  }}
                />
              </Flex>
              <Flex align="flex-end" justify={"flex-end"} w={"100%"}>
                <Button type="submit">Send</Button>
              </Flex>
            </form>
          </Flex>
        </Flex>
      </Flex>
    </>
  );
}

export default App;
