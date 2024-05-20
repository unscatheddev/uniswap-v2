import { PADDED_ZERO_ADDRS } from '../common/constants';
import {
  addTrackedUnderlyingTag,
  extractOperationDefaultStrategy,
  extractPositionSharesDefaultStrategy,
} from '../common/lib/utils';
import { LogDecoder } from '../common/logDecoder';
import { TransferLogDetails } from '../dto/transferLogDetails';
import { AbstractTransferLogTransformer } from './abstractTransferLogTransformer';
import { BlueprintRequest, Classification, OperationType, TokenInfo, TransactionDetails } from 'blueprint-lib';

export class DefaultZapAwareTransferLogTransformer extends AbstractTransferLogTransformer {
  async classifyTransaction(
    blueprintRequest: BlueprintRequest,
    txn: TransactionDetails,
  ): Promise<Classification[] | null> {
    this.context = blueprintRequest.context;
    const txnHash = txn.txHash;
    const tx = await this.context.getContractReader().fetchOrCachedTx(txnHash);
    const txReceipt = await this.contractReader.fetchOrCachedTxReceipt(txnHash);
    this.userAddress = tx.from.toLowerCase();

    if (!this.canParseMethodId(tx.data)) return null;

    // filter out the non transfer events, then make the mapping
    const logDecodeResultMapping = this.contractReader.getDecodedTransferLog(txReceipt.logs);
    const groupedLogs = this.groupLogResultsByTokenTransferred(logDecodeResultMapping);

    this.positionIdentifier = this.getReceiptToken(groupedLogs);
    if (!this.positionIdentifier) return null;
    this.logDecoder = new LogDecoder(this.userAddress, this.positionIdentifier);

    const gasTokenAmount = await this.context.getContractReader().fetchGasUsedInTransaction(txnHash);
    const operationType = this.isMint(groupedLogs[this.positionIdentifier])
      ? OperationType.DEPOSIT
      : OperationType.WITHDRAW;
    const inputTokens = await this.getZapTxInputTokens(
      groupedLogs,
      operationType,
      txReceipt.blockNumber,
      blueprintRequest.blueprintKey,
    );
    const outputTokens = await this.getZapTxOutputTokens(
      groupedLogs,
      operationType,
      txReceipt.blockNumber,
      blueprintRequest.blueprintKey,
    );
    const positionShares = extractPositionSharesDefaultStrategy(inputTokens, outputTokens, this.positionIdentifier);

    if (
      (operationType == OperationType.DEPOSIT && inputTokens.length != 2) ||
      (operationType == OperationType.WITHDRAW && outputTokens.length != 2)
    ) {
      return null;
    }

    const operations = [
      extractOperationDefaultStrategy(inputTokens, outputTokens, this.positionIdentifier, operationType),
    ];

    return [new Classification(operations, this.positionIdentifier, gasTokenAmount, positionShares)];
  }

  protected canParseMethodId(inputData: string): boolean {
    return true;
  }

  protected getReceiptToken(groupedLogs): string | null {
    const receiptTokenLog = this.getReceiptTokenLog(groupedLogs);
    return receiptTokenLog ? receiptTokenLog.tokenAddress : null;
  }

  // MINT txn: when first transfer comes from ZERO ADDRESS and
  // last transfer goes to the user
  protected isMint(logs): boolean {
    return logs[0].from == PADDED_ZERO_ADDRS && logs[logs.length - 1].to == this.userAddress;
  }

  // BURN txn: when first transfer comes from the user and
  // last transfer goes to ZERO ADDRESS
  private isBurn(logs): boolean {
    return logs[0].from.toLowerCase() == this.userAddress && logs[logs.length - 1].to == PADDED_ZERO_ADDRS;
  }

  private getReceiptTokenLog(groupedLogs): TransferLogDetails | null {
    for (const tokenTransferred of Object.keys(groupedLogs)) {
      const logs = groupedLogs[tokenTransferred];
      if (this.isMint(logs)) {
        return logs[logs.length - 1]; // token going to the user
      }
      if (this.isBurn(logs)) {
        return logs[0]; // token sent by the user
      }
    }
    return null;
  }

  // zap address sends tokens to protocol
  // uniswap v2 eth => https://etherscan.io/tx/0x2521a75399c8e8620a99443e79814f452614b985be90391657e80075c985635a
  private async getZapTxInputTokens(
    groupedLogs,
    operation: string,
    blockNumber: number,
    blueprintKey: string,
  ): Promise<TokenInfo[]> {
    if (this.isMint(groupedLogs[this.positionIdentifier])) {
      return await this.getUnderlyingTokensFromLogs(groupedLogs, operation, blockNumber, blueprintKey);
    }

    if (this.isBurn(groupedLogs[this.positionIdentifier])) {
      return this.getReceiptTokenFromLogs(groupedLogs, blockNumber, blueprintKey);
    }

    return [];
  }

  // uniswap v2 eth => https://etherscan.io/tx/0x704916f6a76e6087f143c5dfd04772c14ab4e3d3f72ce62e52b32c071a69dbd6
  private async getZapTxOutputTokens(
    groupedLogs,
    operation: string,
    blockNumber: number,
    blueprintKey: string,
  ): Promise<TokenInfo[]> {
    if (this.isMint(groupedLogs[this.positionIdentifier])) {
      return this.getReceiptTokenFromLogs(groupedLogs, blockNumber, blueprintKey);
    }

    if (this.isBurn(groupedLogs[this.positionIdentifier])) {
      return await this.getUnderlyingTokensFromLogs(groupedLogs, operation, blockNumber, blueprintKey);
    }

    return [];
  }

  private async getUnderlyingTokensFromLogs(
    groupedLogs,
    operation: string,
    blockNumber: number,
    blueprintKey: string,
  ): Promise<TokenInfo[]> {
    const underlyingTokens = [];
    for (const tokenTransferred of Object.keys(groupedLogs)) {
      const logs = groupedLogs[tokenTransferred].filter((log) =>
        operation == OperationType.DEPOSIT ? log.to == this.positionIdentifier : log.from == this.positionIdentifier,
      );
      if (logs.length > 0 && tokenTransferred != this.positionIdentifier) {
        underlyingTokens.push(await this.populateToken(logs[logs.length - 1], blockNumber, blueprintKey));
      }
    }

    return addTrackedUnderlyingTag(underlyingTokens);
  }

  private async getReceiptTokenFromLogs(groupedLogs, blockNumber: number, blueprintKey: string): Promise<TokenInfo[]> {
    const receiptTokens = [];

    for (const tokenTransferred of Object.keys(groupedLogs)) {
      const logs = groupedLogs[tokenTransferred];
      if (logs.length > 0 && tokenTransferred == this.positionIdentifier) {
        receiptTokens.push(await this.populateToken(logs[logs.length - 1], blockNumber, blueprintKey));
      }
    }

    return receiptTokens;
  }

  private async populateToken(
    logPair: TransferLogDetails,
    blockNumber: number,
    blueprintKey: string,
  ): Promise<TokenInfo> {
    const tokenTransferred = logPair.tokenAddress;
    return await this.getTokenInfo(tokenTransferred, logPair.value, blockNumber, blueprintKey);
  }
}
