import type { Voice, VoiceProviderMethods } from "./_types";
import { VoiceProvider } from "./_common";

export class ElevenLabsProvider
  extends VoiceProvider
  implements VoiceProviderMethods
{
  voices: Voice[] = [];

  fetchVoices = async () => {
    const { ELEVENLABS_KEY: API_KEY } = this.env;

    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: {
        "xi-api-key": API_KEY,
        "Content-Type": "application/json",
      },
    });
    const { voices: rawVoices } = (await response.json()) as {
      voices: ElevenLabsVoice[];
    };

    // gender?: "male" | "female" | string;
    // language?: string;
    // accent?: string;
    return rawVoices.map(({ voice_id, name }) => ({
      id: voice_id,
      name,
      gender: "unknown",
      accent: "unknown",
      language: "en",
    }));
  };

  syncVoices = async () => {
    const voices = await this.fetchVoices();
    this.voices = voices;
  };

  async textToSpeech(text: string, voiceId: string) {
    const { ELEVENLABS_KEY: API_KEY } = this.env;

    const voice = this.getVoiceById(voiceId);

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice.id}/stream`,
      {
        method: "POST",
        headers: {
          "xi-api-key": API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2",
        }),
      }
    );
    if (!response.ok) {
      throw new Error((await response.text()) || "error synthesizing voice");
    }

    if (!response.body) {
      throw new Error("voice response body empty");
    }

    return response.body as ReadableStream<Uint8Array>;
  }
}

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  samples: Sample[];
  category: string;
  fine_tuning: FineTuning;
  labels: Labels;
  description: string;
  preview_url: string;
  available_for_tiers: string[];
  settings: Settings;
  sharing: Sharing;
  high_quality_base_model_ids: string[];
  safety_control: string;
  voice_verification: VoiceVerification;
  owner_id: string;
  permission_on_resource: string;
}

interface FineTuning {
  is_allowed_to_fine_tune: boolean;
  finetuning_state: string;
  verification_failures: string[];
  verification_attempts_count: number;
  manual_verification_requested: boolean;
  language: string;
  finetuning_progress: Labels;
  message: string;
  dataset_duration_seconds: number;
  verification_attempts: VerificationAttempt[];
  slice_ids: string[];
  manual_verification: ManualVerification;
}

interface Labels {}

interface ManualVerification {
  extra_text: string;
  request_time_unix: number;
  files: File[];
}

interface File {
  file_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  upload_date_unix: number;
}

interface VerificationAttempt {
  text: string;
  date_unix: number;
  accepted: boolean;
  similarity: number;
  levenshtein_distance: number;
  recording: Recording;
}

interface Recording {
  recording_id: string;
  mime_type: string;
  size_bytes: number;
  upload_date_unix: number;
  transcription: string;
}

interface Sample {
  sample_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  hash: string;
}

interface Settings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
}

interface Sharing {
  status: string;
  history_item_sample_id: string;
  date_unix: number;
  whitelisted_emails: string[];
  public_owner_id: string;
  original_voice_id: string;
  financial_rewards_enabled: boolean;
  free_users_allowed: boolean;
  live_moderation_enabled: boolean;
  rate: number;
  notice_period: number;
  disable_at_unix: number;
  voice_mixing_allowed: boolean;
  featured: boolean;
  category: string;
  reader_app_enabled: boolean;
  ban_reason: string;
  liked_by_count: number;
  cloned_by_count: number;
  name: string;
  description: string;
  labels: Labels;
  review_status: string;
  review_message: string;
  enabled_in_library: boolean;
  instagram_username: string;
  twitter_username: string;
  youtube_username: string;
  tiktok_username: string;
}

interface VoiceVerification {
  requires_verification: boolean;
  is_verified: boolean;
  verification_failures: string[];
  verification_attempts_count: number;
  language: string;
  verification_attempts: VerificationAttempt[];
}
