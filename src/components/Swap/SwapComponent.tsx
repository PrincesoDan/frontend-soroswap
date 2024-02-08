import { Box, CircularProgress, Modal, styled } from '@mui/material';
import { setTrustline } from '@soroban-react/contracts';
import { useSorobanReact } from '@soroban-react/core';
import { AutoColumn } from 'components/Column';
import ConfirmSwapModal from 'components/Swap/ConfirmSwapModal';
import SwapDetailsDropdown from 'components/Swap/SwapDetailsDropdown';
import { ButtonText } from 'components/Text';
import { TransactionFailedContent } from 'components/TransactionConfirmationModal';
import { AppContext, SnackbarIconType } from 'contexts';
import { sendNotification } from 'functions/sendNotification';
import { getClassicStellarAsset } from 'helpers/address';
import { formatTokenAmount } from 'helpers/format';
import { requiresTrustline } from 'helpers/stellar';
import { relevantTokensType } from 'hooks';
import { useToken } from 'hooks/tokens/useToken';
import useGetReservesByPair from 'hooks/useGetReservesByPair';
import { useSwapCallback } from 'hooks/useSwapCallback';
import useSwapMainButton from 'hooks/useSwapMainButton';
import { TokenType } from 'interfaces';
import {
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from 'react';
import { ArrowDown } from 'react-feather';
import { InterfaceTrade, TradeState } from 'state/routing/types';
import { Field } from 'state/swap/actions';
import { useDerivedSwapInfo, useSwapActionHandlers } from 'state/swap/hooks';
import swapReducer, { SwapState, initialState as initialSwapState } from 'state/swap/reducer';
import { opacify } from 'themes/utils';
import SwapCurrencyInputPanel from '../CurrencyInputPanel/SwapCurrencyInputPanel';
import SwapHeader from './SwapHeader';
import { ArrowWrapper, SwapWrapper } from './styleds';
import { ButtonPrimary } from 'components/Buttons/Button';
import { WalletButton } from 'components/Buttons/WalletButton';

const SwapSection = styled('div')(({ theme }) => ({
  position: 'relative',
  backgroundColor: theme.palette.customBackground.module,
  borderRadius: 12,
  padding: 16,
  color: theme.palette.secondary.main,
  fontSize: 14,
  lineHeight: '20px',
  fontWeight: 500,
  '&:before': {
    boxSizing: 'border-box',
    backgroundSize: '100%',
    borderRadius: 'inherit',
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    border: `1px solid ${theme.palette.customBackground.module}`,
  },
  '&:hover:before': {
    borderColor: opacify(8, theme.palette.secondary.main),
  },
  '&:focus-within:before': {
    borderColor: opacify(24, theme.palette.secondary.light),
  },
}));

const OutputSwapSection = styled(SwapSection)`
  border-bottom: ${({ theme }) => `1px solid ${theme.palette.customBackground.module}`};
  border-radius: 16px;
  border: 1px solid rgba(180, 239, 175, 0.2);
  background: ${({ theme }) => theme.palette.customBackground.outputBackground};
`;

export const ArrowContainer = styled('div')`
  display: inline-flex;
  align-items: center;
  justify-content: center;

  width: 100%;
  height: 100%;
`;

function getIsValidSwapQuote(
  trade: InterfaceTrade | undefined,
  tradeState: TradeState,
  swapInputError?: ReactNode,
): boolean {
  return Boolean(!swapInputError && trade && tradeState === TradeState.VALID);
}

interface SwapStateProps {
  showConfirm: boolean;
  tradeToConfirm?: InterfaceTrade;
  swapError?: Error;
  swapResult?: any;
}

const INITIAL_SWAP_STATE = {
  showConfirm: false,
  tradeToConfirm: undefined,
  swapError: undefined,
  swapResult: undefined,
};

export function SwapComponent({
  prefilledState = {},
  disableTokenInputs = false,
}: {
  prefilledState?: Partial<SwapState>;
  disableTokenInputs?: boolean;
}) {
  const sorobanContext = useSorobanReact();
  const { SnackbarContext } = useContext(AppContext);
  const [showPriceImpactModal, setShowPriceImpactModal] = useState<boolean>(false);
  const [txError, setTxError] = useState<boolean>(false);

  const [needTrustline, setNeedTrustline] = useState<boolean>(true);

  const { token: prefilledToken } = useToken(prefilledState.INPUT?.currencyId!);

  // modal and loading
  const [{ showConfirm, tradeToConfirm, swapError, swapResult }, setSwapState] =
    useState<SwapStateProps>(INITIAL_SWAP_STATE);

  const [state, dispatch] = useReducer(swapReducer, { ...initialSwapState, ...prefilledState });
  const { typedValue, recipient, independentField } = state;

  const { onSwitchTokens, onCurrencySelection, onUserInput, onChangeRecipient } =
    useSwapActionHandlers(dispatch);
  const dependentField: Field = independentField === Field.INPUT ? Field.OUTPUT : Field.INPUT;

  useEffect(() => {
    if (prefilledToken) {
      onCurrencySelection(Field.INPUT, prefilledToken);
    }
  }, [onCurrencySelection, prefilledToken]);

  const {
    trade: { state: tradeState, trade },
    allowedSlippage,
    currencyBalances,
    parsedAmount,
    currencies,
    inputError: swapInputError,
  } = useDerivedSwapInfo(state);

  const parsedAmounts = useMemo(
    () => ({
      [Field.INPUT]: independentField === Field.INPUT ? parsedAmount : trade?.inputAmount,
      [Field.OUTPUT]: independentField === Field.OUTPUT ? parsedAmount : trade?.outputAmount,
    }),
    [independentField, parsedAmount, trade],
  );

  const decimals = useMemo(
    () => ({
      [Field.INPUT]:
        independentField === Field.INPUT
          ? trade?.outputAmount?.currency.decimals ?? 7
          : trade?.inputAmount?.currency.decimals ?? 7,
      [Field.OUTPUT]:
        independentField === Field.OUTPUT
          ? trade?.inputAmount?.currency.decimals ?? 7
          : trade?.outputAmount?.currency.decimals ?? 7,
    }),
    [independentField, trade],
  );

  const userHasSpecifiedInputOutput = Boolean(
    currencies[Field.INPUT] &&
      currencies[Field.OUTPUT] &&
      Number(parsedAmounts[independentField]?.value) > 0,
  );

  const fiatValueInput = { data: 0, isLoading: true }; //useUSDPrice(parsedAmounts[Field.INPUT]) //TODO: create USDPrice function when available method to get this, for now it will be shown as loading
  const fiatValueOutput = { data: 0, isLoading: true }; //useUSDPrice(parsedAmounts[Field.OUTPUT])
  const showFiatValueInput = Boolean(parsedAmounts[Field.INPUT]);
  const showFiatValueOutput = Boolean(parsedAmounts[Field.OUTPUT]);

  const maxInputAmount: relevantTokensType | string = useMemo(
    () => currencyBalances[Field.INPUT],
    // () => maxAmountSpend(currencyBalances[Field.INPUT]), TODO: Create maxAmountSpend if is native token (XLM) should count for the fees and minimum xlm for the account to have
    [currencyBalances],
  );

  const handleInputSelect = useCallback(
    (inputCurrency: TokenType) => {
      onCurrencySelection(Field.INPUT, inputCurrency);
    },
    [onCurrencySelection],
  );

  const handleOutputSelect = useCallback(
    (outputCurrency: TokenType) => {
      onCurrencySelection(Field.OUTPUT, outputCurrency);
    },
    [onCurrencySelection],
  );

  const handleTypeInput = useCallback(
    (value: string) => {
      onUserInput(Field.INPUT, value);
    },
    [onUserInput],
  );
  const handleTypeOutput = useCallback(
    (value: string) => {
      onUserInput(Field.OUTPUT, value);
    },
    [onUserInput],
  );

  const formattedAmounts = useMemo(
    () => ({
      [independentField]: typedValue,
      [dependentField]: formatTokenAmount(trade?.expectedAmount, decimals[independentField]),
    }),
    [decimals, dependentField, independentField, trade?.expectedAmount, typedValue],
  );

  const showMaxButton = Boolean((maxInputAmount as relevantTokensType)?.balance ?? 0 > 0);

  const [routeNotFound, routeIsLoading, routeIsSyncing] = useMemo(
    () => [
      tradeState === TradeState.NO_ROUTE_FOUND,
      tradeState === TradeState.LOADING,
      tradeState === TradeState.LOADING && Boolean(trade),
    ],
    [trade, tradeState],
  );

  const handleContinueToReview = useCallback(() => {
    setSwapState({
      tradeToConfirm: trade,
      swapError: undefined,
      showConfirm: true,
      swapResult: undefined,
    });
  }, [trade]);

  const handleConfirmDismiss = useCallback(() => {
    setSwapState((currentState) => ({ ...currentState, showConfirm: false }));
    // If there was a swap, we want to clear the input
    if (swapResult) {
      onUserInput(Field.INPUT, '');
    }
  }, [onUserInput, swapResult]);

  const { doSwap: swapCallback, isLoading } = useSwapCallback(
    trade,
    // swapFiatValues,
    // allowedSlippage,
  );

  const handleSwap = () => {
    if (!swapCallback) {
      return;
    }
    // if (stablecoinPriceImpact && !confirmPriceImpactWithoutFee(stablecoinPriceImpact)) {
    //   return
    // }
    setSwapState((currentState) => ({
      ...currentState,
      swapError: undefined,
      swapResult: undefined,
    }));
    swapCallback()
      .then((result) => {
        setSwapState((currentState) => ({
          ...currentState,
          swapError: undefined,
          swapResult: result,
        }));
      })
      .catch((error) => {
        console.log(error);
        setTxError(true);
        setSwapState((currentState) => ({
          ...currentState,
          showConfirm: false,
        }));
      });
  };

  const handleTrustline = () => {
    const asset = getClassicStellarAsset(trade?.outputAmount?.currency.name!);
    if (!asset) return;

    setTrustline({ tokenSymbol: asset.assetCode, tokenAdmin: asset.issuer, sorobanContext })
      .then((result) => {
        setNeedTrustline(false);
        sendNotification(
          `for ${asset.assetCode}`,
          'Trustline set',
          SnackbarIconType.MINT,
          SnackbarContext,
        );
      })
      .catch((error) => {
        // console.log(error);
        setTxError(true);
        setSwapState((currentState) => ({
          ...currentState,
          showConfirm: false,
        }));
      });
  };

  const showDetailsDropdown = Boolean(
    userHasSpecifiedInputOutput && (trade || routeIsLoading || routeIsSyncing),
  );

  const inputCurrency = currencies[Field.INPUT] ?? undefined;
  const priceImpactSeverity = 2; //IF is < 2 it shows Swap anyway button in red
  const showPriceImpactWarning = false;

  const { reserves } = useGetReservesByPair({
    baseAddress: currencies[Field.INPUT]?.address,
    otherAddress: currencies[Field.OUTPUT]?.address,
  });

  const { getMainButtonText, isMainButtonDisabled, handleMainButtonClick, getSwapValues } =
    useSwapMainButton({
      currencies,
      currencyBalances,
      formattedAmounts,
      routeNotFound,
      onSubmit: handleContinueToReview,
      reserves,
    });

  useEffect(() => {
    const checkRequiresTrustlineAdjust = async () => {
      if (!swapCallback) {
        return;
      }

      try {
        const simulatedTransaction = await swapCallback(true);
        if (simulatedTransaction) {
          return false;
        }
      } catch (error) {
        return true;
      }
    };

    const checkTrustline = async () => {
      if (!trade) return;

      const needTrustline = await requiresTrustline(
        trade?.outputAmount?.currency.address!,
        sorobanContext,
      );
      const requiresTrustlineAdjust = await checkRequiresTrustlineAdjust();

      if (needTrustline || requiresTrustlineAdjust) {
        setNeedTrustline(true);
      } else {
        setNeedTrustline(false);
      }
    };

    checkTrustline();
  }, [sorobanContext, swapCallback, trade]);

  return (
    <>
      <SwapWrapper>
        <SwapHeader />
        <Modal
          open={txError}
          onClose={() => setTxError(false)}
          aria-labelledby="modal-modal-title"
          aria-describedby="modal-modal-description"
        >
          <div>
            <TransactionFailedContent onDismiss={() => setTxError(false)} />
          </div>
        </Modal>
        {trade && showConfirm && (
          <ConfirmSwapModal
            trade={trade}
            inputCurrency={inputCurrency}
            originalTrade={tradeToConfirm}
            onAcceptChanges={() => null} //handleAcceptChanges}
            onCurrencySelection={onCurrencySelection}
            swapResult={swapResult}
            allowedSlippage={allowedSlippage} //allowedSlippage}
            onConfirm={handleSwap}
            onSetTrustline={handleTrustline}
            trustline={needTrustline}
            swapError={swapError}
            onDismiss={handleConfirmDismiss}
            swapQuoteReceivedDate={new Date()} //swapQuoteReceivedDate}
            fiatValueInput={{ data: 32, isLoading: false }} //fiatValueTradeInput}
            fiatValueOutput={{ data: 32, isLoading: false }} //fiatValueTradeOutput}
          />
        )}
        {/* {showPriceImpactModal && showPriceImpactWarning && (
          <PriceImpactModal
            priceImpact={largerPriceImpact}
            onDismiss={() => setShowPriceImpactModal(false)}
            onContinue={() => {
              setShowPriceImpactModal(false)
              handleContinueToReview()
            }}
          />
        )} */}
        <div style={{ display: 'relative' }}>
          <SwapSection>
            <SwapCurrencyInputPanel
              data-testid="Swap__panel"
              label={
                independentField === Field.OUTPUT ? <span>From (at most)</span> : <span>From</span>
              }
              // disabled={disableTokenInputs}
              value={
                sorobanContext?.address && getSwapValues().insufficientLiquidity
                  ? '0'
                  : formattedAmounts[Field.INPUT]
              }
              showMaxButton={showMaxButton}
              onUserInput={handleTypeInput}
              onMax={(maxBalance) => handleTypeInput(maxBalance.toString())}
              fiatValue={showFiatValueInput ? fiatValueInput : undefined}
              onCurrencySelect={handleInputSelect}
              otherCurrency={currencies[Field.OUTPUT]}
              // showCommonBases
              // id={InterfaceSectionName.CURRENCY_INPUT_PANEL}
              loading={independentField === Field.OUTPUT && routeIsSyncing}
              currency={currencies[Field.INPUT] ?? null}
              id={'swap-input'}
              disableInput={getSwapValues().noLiquidity || getSwapValues().noCurrencySelected}
            />
          </SwapSection>
          <ArrowWrapper clickable={true}>
            <ArrowContainer
              data-testid="swap-currency-button"
              onClick={() => {
                !disableTokenInputs && onSwitchTokens();
              }}
            >
              <ArrowDown
                size="16"
                color={'#000000'} //currencies[Field.INPUT] && currencies[Field.OUTPUT] ? theme.palette.custom.textTertiary}
              />
            </ArrowContainer>
          </ArrowWrapper>
        </div>
        <AutoColumn gap="14px">
          <div>
            <OutputSwapSection>
              <SwapCurrencyInputPanel
                id={'swap-output'}
                value={formattedAmounts[Field.OUTPUT]}
                //disabled={disableTokenInputs}
                onUserInput={handleTypeOutput}
                // onUserInput={(value: string) => handleOutputTokenAmountChange(Number(value))}
                label={
                  independentField === Field.INPUT ? <span>To (at least)</span> : <span>To</span>
                }
                showMaxButton={false}
                hideBalance={false}
                onMax={() => {}}
                fiatValue={showFiatValueOutput ? fiatValueOutput : undefined}
                //priceImpact={stablecoinPriceImpact}
                currency={currencies[Field.OUTPUT] ?? null}
                onCurrencySelect={handleOutputSelect}
                otherCurrency={currencies[Field.INPUT]}
                //showCommonBases
                //id={InterfaceSectionName.CURRENCY_OUTPUT_PANEL}
                loading={independentField === Field.INPUT && routeIsSyncing}
                disableInput={getSwapValues().noLiquidity || getSwapValues().noCurrencySelected}
              />
            </OutputSwapSection>
          </div>
          {showDetailsDropdown && !getSwapValues().insufficientLiquidity && (
            <SwapDetailsDropdown
              noLiquidity={getSwapValues().noLiquidity}
              trade={trade}
              syncing={routeIsSyncing}
              loading={routeIsLoading}
              allowedSlippage={allowedSlippage}
            />
          )}
          {/* {showPriceImpactWarning && <PriceImpactWarning priceImpact={largerPriceImpact} />} */}
          <div>
            {sorobanContext.address ? (
                <ButtonPrimary
              disabled={isMainButtonDisabled() || isLoading}
              onClick={handleMainButtonClick}
              sx={{ height: '64px' }}
            >
                <ButtonText fontSize={20} fontWeight={600}>
                  {isLoading ? (
                  <Box display="flex" alignItems="center">
                    <CircularProgress size="24px" />
                  </Box>
                ) : (
                  getMainButtonText()
                )}
                </ButtonText>
              </ButtonPrimary>
            ):(
              <WalletButton/>
            )}
          </div>
        </AutoColumn>
      </SwapWrapper>
    </>
  );
}
