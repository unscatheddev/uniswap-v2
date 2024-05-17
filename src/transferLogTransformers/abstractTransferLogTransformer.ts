import { PADDED_ZERO_ADDRS } from '../common/constants';
import { isDepositOrTransferIn, isWithdrawOrTransferOut } from '../common/lib/utils';
import { addTrackedUnderlyingTag } from '../common/lib/utils';
import { LogDecoder } from '../common/logDecoder';
import { TransferLogDetails } from '../dto/transferLogDetails';
import { TransferLogTransformer } from './transferLogTransformer';
import BigNumber from 'bignumber.js';
import {
  BlueprintContext,
  BlueprintRequest,
  Classification,
  EvmContractReader,
  OperationType,
  TokenInfo,
  TransactionDetails,
} from 'blueprint-lib';

export abstract class AbstractTransferLogTransformer implements TransferLogTransformer {
  protected context: BlueprintContext;
  protected userAddress: string;
  protected positionIdentifier: string;
  protected logDecoder: LogDecoder;
  protected contractReader: EvmContractReader;

  constructor(context: BlueprintContext) {
    this.contractReader = context.getContractReader() as EvmContractReader;
  }

  abstract classifyTransaction(
    blueprintRequest: BlueprintRequest,
    transaction: TransactionDetails,
  ): Promise<Classification[]>;

  protected async getInputTokens(
    logDecodeResultMapping: TransferLogDetails[],
    blockNumber: number,
    operationType: OperationType,
    blueprintKey: string,
  ): Promise<TokenInfo[]> {
    const inputTokens = [];

    for (const logPair of logDecodeResultMapping) {
      const tokenTransferred = logPair.tokenAddress;
      if (
        operationType == OperationType.NULL_OP &&
        this.logDecoder.isReceiptTokenTransfer(logPair) &&
        this.logDecoder.isFromUser(logPair)
      ) {
        inputTokens.push(await this.getTokenInfo(tokenTransferred, logPair.value, blockNumber, blueprintKey));
      }

      if (
        (operationType != OperationType.NULL_OP &&
          this.logDecoder.isToProtocol(logPair) &&
          tokenTransferred != this.positionIdentifier) ||
        (this.logDecoder.isToNull(logPair) && tokenTransferred == this.positionIdentifier)
      ) {
        inputTokens.push(await this.getTokenInfo(tokenTransferred, logPair.value, blockNumber, blueprintKey));
      }
    }

    return isDepositOrTransferIn(operationType) ? addTrackedUnderlyingTag(inputTokens) : inputTokens;
  }

  protected async getOutputTokens(
    logDecodeResultMapping: TransferLogDetails[],
    blockNumber: number,
    operationType: OperationType,
    blueprintKey: string,
  ): Promise<TokenInfo[]> {
    const outputTokens = [];
    for (const logPair of logDecodeResultMapping) {
      const tokenTransferred = logPair.tokenAddress;
      if (
        operationType == OperationType.NULL_OP &&
        this.logDecoder.isToUser(logPair) &&
        this.logDecoder.isReceiptTokenTransfer(logPair)
      ) {
        const tokenInfo = await this.getTokenInfo(tokenTransferred, logPair.value, blockNumber, blueprintKey);
        outputTokens.push(tokenInfo);
      }

      if (
        operationType != OperationType.NULL_OP &&
        (this.logDecoder.isUnderlyingTokenTransfer(logPair) ||
          (this.logDecoder.isFromNull(logPair) && this.logDecoder.isToUser(logPair)))
      ) {
        const tokenInfo = await this.getTokenInfo(tokenTransferred, logPair.value, blockNumber, blueprintKey);
        outputTokens.push(tokenInfo);
      }
    }

    return isWithdrawOrTransferOut(operationType) ? addTrackedUnderlyingTag(outputTokens) : outputTokens;
  }

  protected getOperationType(logDecodeResultMapping: TransferLogDetails[]): OperationType {
    const depositOrWithdrawOperation = this.getDepositOrWithdrawOperationType(logDecodeResultMapping);
    if (depositOrWithdrawOperation) return depositOrWithdrawOperation;

    const transferOrNullOperation = this.getTransferOrNullOperationType(logDecodeResultMapping);
    if (transferOrNullOperation) return transferOrNullOperation;

    return null;
  }

  private getDepositOrWithdrawOperationType(logDecodeResultMapping: TransferLogDetails[]): OperationType | null {
    const groupedLogs = this.groupLogResultsByTokenTransferred(logDecodeResultMapping);
    const numTokensTransferred = Object.keys(groupedLogs).length;

    const receiptTokenMintLogs = this.receiptTokenMintLogs(logDecodeResultMapping);
    if (numTokensTransferred == 3 && receiptTokenMintLogs.length > 0) {
      return OperationType.DEPOSIT;
    }

    const receiptTokenBurnLogs = this.receiptTokenBurnLogs(logDecodeResultMapping);
    if (numTokensTransferred == 3 && receiptTokenBurnLogs.length > 0) {
      return OperationType.WITHDRAW;
    }

    return null;
  }

  protected getTransferOrNullOperationType(logDecodeResultMapping: TransferLogDetails[]): OperationType | null {
    const logsFromUser = this.logDecoder.logsFromUser(logDecodeResultMapping);
    if (logsFromUser.length > 0) {
      const addressesSentTo = logsFromUser.map((logPair) => logPair.to);
      const isSentToContractAddressOrSmartWallet = addressesSentTo.find(
        async (address) => await this.isContractOrSmartWallet(address),
      );
      return isSentToContractAddressOrSmartWallet ? OperationType.NULL_OP : OperationType.TRANSFER_OUT;
    }

    const logsToUser = this.logDecoder.logsToUser(logDecodeResultMapping);
    if (logsToUser.length > 0) {
      const addressesReceivedFrom = logsToUser.map((logPair) => logPair.from);
      const isReceivedFromContractAddress = addressesReceivedFrom.find(
        async (address) => await this.isContractOrSmartWallet(address),
      );
      return isReceivedFromContractAddress ? OperationType.NULL_OP : OperationType.TRANSFER_IN;
    }

    return null;
  }

  protected receiptTokenMintLogs(logDecodeResultMapping: TransferLogDetails[]): TransferLogDetails[] {
    return logDecodeResultMapping.filter(
      (log) =>
        log.from == PADDED_ZERO_ADDRS && log.to == this.userAddress && log.tokenAddress == this.positionIdentifier,
    );
  }

  protected receiptTokenBurnLogs(logDecodeResultMapping: TransferLogDetails[]): TransferLogDetails[] {
    return logDecodeResultMapping.filter(
      (log) => log.to == PADDED_ZERO_ADDRS && log.tokenAddress == this.positionIdentifier,
    );
  }

  protected async getTokenInfo(
    tokenTransferred: string,
    value: BigNumber,
    blockNumber: number,
    blueprintKey?: string,
  ): Promise<TokenInfo> {
    if (blueprintKey) {
      return this.getTokenInfoWithPriceSource(tokenTransferred, value, blockNumber, blueprintKey);
    }

    return this.getTokenInfoWithGenericPrice(tokenTransferred, value, blockNumber);
  }

  protected async getLogsTxHashAndTxReceipt(txn: TransactionDetails, blueprintRequest: BlueprintRequest) {
    const txnHash = txn.txHash;
    this.context = blueprintRequest.context;
    const txReceipt = await this.contractReader.fetchOrCachedTxReceipt(txnHash);
    this.userAddress = txReceipt.from.toLowerCase();
    const logDecodeResultMapping = this.contractReader.getDecodedTransferLog(txReceipt.logs);
    return { logDecodeResultMapping, txnHash, txReceipt };
  }

  private async getTokenInfoWithPriceSource(
    tokenTransferred: string,
    value: BigNumber,
    blockNumber: number,
    blueprintKey: string,
  ): Promise<TokenInfo> {
    let tokenPriceObj;
    const tokenAmount = await this.contractReader.getRawDecimalAwareAmount(tokenTransferred, value);
    const receiptTokenAddress = tokenTransferred == this.positionIdentifier ? tokenTransferred : '';

    if (receiptTokenAddress) {
      tokenPriceObj = await this.context
        .getExchangePrice()
        .getReceiptTokenPriceAt(tokenTransferred, blueprintKey, blockNumber);
      return new TokenInfo(tokenTransferred, tokenPriceObj.price, tokenAmount, tokenPriceObj.source);
    }

    tokenPriceObj = await this.context.getExchangePrice().getPriceOfAt(tokenTransferred, blueprintKey, blockNumber);
    return new TokenInfo(tokenTransferred, tokenPriceObj.price, tokenAmount, tokenPriceObj.source);
  }

  private async getTokenInfoWithGenericPrice(
    tokenTransferred: string,
    value: BigNumber,
    blockNumber: number,
  ): Promise<TokenInfo> {
    const tokenPriceObj = await this.context.getExchangePrice().getGenericPriceOfAt(tokenTransferred, blockNumber);
    const tokenAmount = await this.context.getContractReader().getRawDecimalAwareAmount(tokenTransferred, value);
    return new TokenInfo(tokenTransferred, tokenPriceObj.price, tokenAmount, tokenPriceObj.source);
  }

  protected groupLogResultsByTokenTransferred(logDecodeResultMapping: TransferLogDetails[]): object {
    return logDecodeResultMapping.reduce(function (rv, item) {
      (rv[item.tokenAddress] = rv[item.tokenAddress] || []).push(item);
      return rv;
    }, {});
  }

  private async isContractOrSmartWallet(address: string): Promise<boolean> {
    return (
      (await this.context.getContractReader().isContractAddress(address)) ||
      (await this.isSmartWallet(this.context, address))
    );
  }

  private async isSmartWallet(context: BlueprintContext, address: string) {
    const walletName = await new ContractName(context).getContractName(address);
    return walletName == 'Proxy' || walletName == 'InstaAccount';
  }
}
