import { extractOperationDefaultStrategy, extractPositionSharesDefaultStrategy } from '../src/common/lib/utils';
import { LogDecoder } from '../src/common/logDecoder';
import { TransferLogDetails } from '../src/dto/transferLogDetails';
import { AbstractTransferLogTransformer } from '../src/transferLogTransformers/abstractTransferLogTransformer';
import { UniswapV2EthGraphExplorer } from './uniswapV2EthGraphExplorer';
import { BlueprintRequest, Classification, TransactionDetails } from 'blueprint-lib';

export class UniswapEthTransactionClassifier extends AbstractTransferLogTransformer {
  async classifyTransaction(
    blueprintRequest: BlueprintRequest,
    txn: TransactionDetails,
  ): Promise<Classification[] | null> {
    const txnHash = txn.txHash;
    this.context = blueprintRequest.context;
    const txReceipt = await this.contractReader.fetchOrCachedTxReceipt(txnHash);
    this.userAddress = txReceipt.from.toLowerCase();
    const logDecodeResultMapping = this.contractReader.getDecodedTransferLog(txReceipt.logs);

    this.positionIdentifier = await this.getPositionIdentifier(logDecodeResultMapping);
    if (!this.positionIdentifier) return null;
    this.logDecoder = new LogDecoder(this.userAddress, this.positionIdentifier);

    const operationType = this.getOperationType(logDecodeResultMapping);

    const inputTokensPromise = this.getInputTokens(
      logDecodeResultMapping,
      txReceipt.blockNumber,
      operationType,
      blueprintRequest.blueprintKey,
    );
    const outputTokensPromise = this.getOutputTokens(
      logDecodeResultMapping,
      txReceipt.blockNumber,
      operationType,
      blueprintRequest.blueprintKey,
    );
    const gasUsedPromise = this.context.getContractReader().fetchGasUsedInTransaction(txnHash);

    const [inputTokens, outputTokens, gasUsed] = await Promise.all([
      inputTokensPromise,
      outputTokensPromise,
      gasUsedPromise,
    ]);
    const positionShares = extractPositionSharesDefaultStrategy(inputTokens, outputTokens, this.positionIdentifier);
    const operations = [
      extractOperationDefaultStrategy(inputTokens, outputTokens, this.positionIdentifier, operationType),
    ];

    return [new Classification(operations, this.positionIdentifier, gasUsed, positionShares)];
  }

  private async getPositionIdentifier(logDecodeResultMapping: TransferLogDetails[]): Promise<string | null> {
    const groupedLogs = this.groupLogResultsByTokenTransferred(logDecodeResultMapping);
    const userPositions = await new UniswapV2EthGraphExplorer(
      this.context,
      this.context.getAxiosManager(),
    ).getUserPositions(this.context, this.userAddress, 'uniswap_v2_eth');
    const tokensTransferred = Object.keys(groupedLogs);
    for (const token of tokensTransferred) {
      const positionIdentifier = userPositions.find((position) => position == token);
      if (positionIdentifier) return positionIdentifier;
    }

    return null;
  }
}
