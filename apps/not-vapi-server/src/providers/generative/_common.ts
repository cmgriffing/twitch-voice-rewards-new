import { AiProvider } from "../_common";
import { GenerativeModel } from "./_types";

export class GenerativeProvider extends AiProvider {
  models: GenerativeModel[] = [];

  async init() {
    await this.syncModels();
    return this;
  }

  fetchModels: () => Promise<GenerativeModel[]> = async () => {
    throw new Error("fetchModels not implemented for GenerativeProvider");
  };

  syncModels: () => Promise<void> = async () => {
    this.models = await this.fetchModels();
  };

  getModelById(modelId: string): GenerativeModel {
    const model = this.models.find((model) => model.id === modelId);

    if (!model) {
      throw new Error(`Voice ${modelId} not found`);
    }

    return model;
  }
}
