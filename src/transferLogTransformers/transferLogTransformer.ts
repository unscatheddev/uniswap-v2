import { BlueprintRequest, Classification, TransactionDetails } from 'blueprint-lib';

export interface TransferLogTransformer {
  classifyTransaction(
    blueprintRequest: BlueprintRequest,
    txn: TransactionDetails,
    blueprintKey: string,
  ): Promise<Classification[]>;
}
