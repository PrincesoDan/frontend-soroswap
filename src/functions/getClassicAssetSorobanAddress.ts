import { SorobanContextType } from 'stellar-react';
import { getClassicStellarAsset, isAddress } from 'helpers/address';
import * as StellarSdk from '@stellar/stellar-sdk';

export function getClassicAssetSorobanAddress(
  classicAsset: string,
  sorobanContext: SorobanContextType,
): string | false {
  const assetParts = getClassicStellarAsset(classicAsset);

  if (!assetParts) {
    return false;
  }

  const { assetCode, issuer } = assetParts;
  const networkPassphrase = sorobanContext.activeNetwork ?? '';

  try {
    const asset = new StellarSdk.Asset(assetCode, issuer);
    const sorobanAddress = asset.contractId(networkPassphrase);

    return isAddress(sorobanAddress) ? sorobanAddress : false;
  } catch (error) {
    return false;
  }
}
