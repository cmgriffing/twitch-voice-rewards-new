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
  Drawer,
  List,
  ActionIcon,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconCheck, IconTrash } from "@tabler/icons-react";
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

// function handleSpeechEnd(
//   queue: { current: string[] },
//   isSpeaking: { current: boolean }
// ) {
//   if (isSpeaking.current) {
//     console.log("Still speaking, bailing out of speech end");
//     return;
//   }

//   console.log("queue after shift: ", queue.current);

//   const username = queue.current.shift();

//   console.log("queue after shift: ", queue.current);

//   if (username) {
//     // sendMessageToVapi(vapi, username);
//   } else {
//     // is this the right place?
//     // vapi.stop();
//   }
// }

// const speechEndHandler = debounce(handleSpeechEnd, 5000);

async function fetchPromptAudio(requestBody: {
  prompt: string;
  username: string;
  voiceProvider: string;
  voiceId: string;
  generativeProvider: string;
  generativeModel: string;
}) {
  const response = await fetch(`${apiBaseUrl}/prompt`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const responseBuffer = await response.arrayBuffer();

  return responseBuffer;
}

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
  const [userQueue, setUserQueue] = useState<string[]>([]);
  // const [userQueue, setUserQueue] = useState<string[]>([
  //   "cmgriffing",
  //   "foo",
  //   "bar",
  // ]);

  // const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentUsername, setCurrentUsername] = useState("");

  const [queueOpened, { open: openQueue, close: closeQueue }] = useDisclosure();

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

    const audioEndedListener = function () {
      setCurrentUsername("");
    };

    if (audioRef.current) {
      audioRef.current.addEventListener("ended", audioEndedListener);
    }

    return () => {
      if (audioRef.current) {
        audioRef.current.removeEventListener("ended", audioEndedListener);
      }
    };
  }, []);

  useEffect(() => {
    function addUserToQueue(username: string) {
      setUserQueue((currentUserQueue) => [...currentUserQueue, username]);
    }
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
                if (usedBits >= minBits) {
                  addUserToQueue(userstate.username);
                }
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
                addUserToQueue(giftedUsername);
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
                addUserToQueue(giftedUsername);
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
              addUserToQueue(username);
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
              addUserToQueue(username);
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
                addUserToQueue(username);
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
                userstate.username
                // && !!userstate.subscriber
                //  && userstate.username === "cmgriffing"
              ) {
                addUserToQueue(userstate.username);
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

  useEffect(() => {
    const interval = setInterval(async () => {
      if (!currentUsername && userQueue.length > 0) {
        const [username, ...theRestOfTheNames] = userQueue;
        setCurrentUsername(username);
        setUserQueue(theRestOfTheNames);

        const responseBuffer = await fetchPromptAudio({
          prompt: selectedPrompt.promptText || customPrompt,
          username,
          generativeProvider: selectedGenerativeProvider,
          generativeModel: selectedGenerativeModel,
          voiceProvider: selectedVoiceProvider,
          voiceId: selectedVoice,
        });

        if (audioRef.current) {
          const blob = new Blob([responseBuffer], {
            type: "audio/mpeg",
          });
          audioRef.current.src = URL.createObjectURL(blob);
        }
      }
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [
    userQueue,
    currentUsername,
    customPrompt,
    selectedPrompt,
    selectedGenerativeModel,
    selectedGenerativeProvider,
    selectedVoiceProvider,
    selectedVoice,
  ]);

  return (
    <>
      <Drawer
        opened={queueOpened}
        onClose={closeQueue}
        title={"Queue"}
        position="right"
        keepMounted
        // w={"240px"}
        size="xs"
      >
        <Flex direction="column" gap="1rem">
          <Flex align="center" justify={"center"} direction={"column"}>
            {!currentUsername && !userQueue.length && (
              <Flex>No current username</Flex>
            )}
            {Boolean(currentUsername) && (
              <Flex direction="column" w="100%">
                <Text fw="bold">Current Username</Text>
                {currentUsername}
              </Flex>
            )}
            <audio controls autoPlay ref={audioRef}></audio>
          </Flex>

          <List listStyleType="none" w="100%">
            {!userQueue.length && <Flex>Queue empty</Flex>}
            {userQueue.map((username, index) => {
              return (
                <li>
                  <Flex
                    bg={index % 2 == 1 ? "#E0E0E0" : "#EEEEEE"}
                    p={8}
                    w="100%"
                    justify={"space-between"}
                  >
                    <Text>{username}</Text>
                    <ActionIcon
                      bg="red"
                      onClick={() => {
                        setUserQueue(userQueue.filter((u, i) => i !== index));
                      }}
                    >
                      <IconTrash />
                    </ActionIcon>
                  </Flex>
                </li>
              );
            })}
          </List>

          <Flex direction="column" bg={"#ffeeee"} p="1rem" gap="1rem">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (manualUsername.trim()) {
                  setUserQueue([...userQueue, manualUsername]);
                  setManualUsername("");
                }
              }}
            >
              <Text fw={600}>Add User to Queue</Text>
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
      </Drawer>

      <Button
        style={{
          position: "fixed",
          right: "1rem",
          top: "1rem",
        }}
        onClick={() => {
          if (queueOpened) {
            closeQueue();
          } else {
            openQueue();
          }
        }}
      >
        Queue
      </Button>

      <Flex w={"100%"} direction="column">
        <Text size="xl" fw={700} ta="center">
          🔊 Twitch Voice Rewards 🔊
        </Text>
        <Text ta="center">
          Reward your Twitch supporters with a Voice Assistant acknowledging
          them.
        </Text>
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
        </Flex>
      </Flex>
    </>
  );
}

export default App;
