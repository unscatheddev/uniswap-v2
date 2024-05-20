import { TransferLogDetails } from '../dto/transferLogDetails';
import { PADDED_ZERO_ADDRS } from './constants';

export class LogDecoder {
  constructor(
    private userAddress: string,
    private positionIdentifier: string,
  ) {}

  isToUser(logPair: TransferLogDetails): boolean {
    return logPair.to == this.userAddress;
  }

  isFromUser(logPair: TransferLogDetails): boolean {
    return logPair.from == this.userAddress;
  }

  isToProtocol(logPair: TransferLogDetails): boolean {
    return logPair.to == this.positionIdentifier;
  }

  isFromProtocol(logPair: TransferLogDetails): boolean {
    return logPair.from == this.positionIdentifier;
  }

  isToNull(logPair: TransferLogDetails): boolean {
    return logPair.to == PADDED_ZERO_ADDRS && logPair.from != PADDED_ZERO_ADDRS;
  }

  isFromNull(logPair: TransferLogDetails): boolean {
    return logPair.from == PADDED_ZERO_ADDRS && logPair.to != PADDED_ZERO_ADDRS;
  }

  isReceiptTokenTransfer(logPair: TransferLogDetails): boolean {
    return logPair.tokenAddress == this.positionIdentifier;
  }

  isUnderlyingTokenTransfer(logPair: TransferLogDetails): boolean {
    return logPair.from == this.positionIdentifier && logPair.tokenAddress != this.positionIdentifier;
  }

  isFromProtocolToUser(logPair: TransferLogDetails): boolean {
    return logPair.from == this.positionIdentifier && logPair.to == this.userAddress;
  }

  isFromUserToProtocol(logPair: TransferLogDetails): boolean {
    return logPair.from == this.userAddress && logPair.to == this.positionIdentifier;
  }

  logsFromUser(logDecodeResultMapping: TransferLogDetails[]): TransferLogDetails[] {
    return logDecodeResultMapping.filter((log) => log.from == this.userAddress);
  }

  logsToUser(logDecodeResultMapping: TransferLogDetails[]): TransferLogDetails[] {
    return logDecodeResultMapping.filter((log) => log.to == this.userAddress);
  }
}
