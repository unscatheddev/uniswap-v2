import { BlueprintContext } from 'blueprint-lib';

export class BlueprintRequest {
  constructor(
    public context: BlueprintContext,
    public blueprintKey: string,
    public userAddresses: string[],
  ) {}

  getContext(): BlueprintContext {
    return this.context;
  }
}
