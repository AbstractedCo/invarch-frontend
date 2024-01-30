import { Dialog, Tab } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { zodResolver } from "@hookform/resolvers/zod";
import { web3Enable, web3FromAddress } from "@polkadot/extension-dapp";
import { formatBalance } from "@polkadot/util";
import BigNumber from "bignumber.js";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { z } from "zod";
import { shallow } from "zustand/shallow";
import { ISignAndSendCallback, getSignAndSendCallbackWithPromise } from "../utils/getSignAndSendCallback";
import useApi from "../hooks/useApi";
import useAccount from "../stores/account";
import useModal, { MODAL_STYLE, Metadata, ModalState, modalName } from "../stores/modals";
import classNames from "../utils/classNames";
import Input from "../components/Input";
import Button from "../components/Button";
import { StakingCore, TotalUserStakedData } from "../routes/staking";
import Dropdown from "../components/Dropdown";
import { INVARCH_WEB3_ENABLE } from "../hooks/useConnect";
import { TOKEN_SYMBOL } from "../utils/consts";

export interface SelectedCoreInfo extends Metadata {
  id: number;
  userStaked: BigNumber | undefined;
  name: string;
  availableBalance: string | undefined;
}

const NO_METADATA_ERROR = "Metadata not available";

const mode = {
  STAKE: "STAKE",
  UNSTAKE: "UNSTAKE",
} as const;

const schema = z.object({
  amount: z.string().refine((val) => !Number.isNaN(parseInt(val)), {
    message: "Amount must be a number",
  }),
});

const ManageStaking = (props: { isOpen: boolean; }) => {
  const { isOpen } = props;
  const [stakingCores, setStakingCores] = useState<StakingCore[]>([]);
  const [selectedCore, setSelectedCore] = useState<StakingCore | null>(null);
  const [totalUserStakedData, setTotalUserStakedData] = useState<TotalUserStakedData>({});
  const [altBalance, isAltBalance] = useState<boolean>(false);
  const [coreStakedBalance, setCoreStakedBalance] = useState<string>("0");
  const { closeCurrentModal, openModals } = useModal<ModalState>(
    (state) => state,
    shallow
  );
  const targetModal = openModals.find(modal => modal.name === modalName.MANAGE_STAKING);
  const metadata = targetModal ? targetModal.metadata : undefined;
  const initialSelectedCore = useRef<Metadata | undefined>(metadata);
  const selectedAccount = useAccount((state) => state.selectedAccount);
  const stakeForm = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    mode: "onBlur",
  });
  const unstakeForm = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    mode: "onBlur",
  });
  const api = useApi();
  const watchedUnstakeAmount = unstakeForm.watch('amount');
  const watchedStakeAmount = stakeForm.watch('amount');

  const selectedCoreInfo = useMemo(() => {
    return selectedCore
      ? { id: selectedCore.key, userStaked: totalUserStakedData[selectedCore.key], name: selectedCore.metadata.name } as SelectedCoreInfo
      : null;
  }, [selectedCore, totalUserStakedData]);
  const initialCore = initialSelectedCore.current?.metadata as SelectedCoreInfo;

  const handleStake = stakeForm.handleSubmit(async ({ amount }) => {
    if (!selectedAccount) return;

    if (!metadata) throw new Error(NO_METADATA_ERROR);

    const parsedAmount = parseFloat(amount);

    if (Number.isNaN(parsedAmount)) {
      stakeForm.setError("amount", {
        type: "valueAsNumber",
        message: "Amount must be a number",
      });

      return;
    }

    let maxValue;
    if (altBalance) {
      maxValue = coreStakedBalance;
    } else {
      maxValue = new BigNumber(metadata.availableBalance as string)
        .dividedBy(new BigNumber(10).pow(12))
        .toString();
    }

    const minValue = new BigNumber(50);

    if (parsedAmount <= 0) {
      stakeForm.setError("amount", {
        type: "min",
        message: "Amount must be greater than or equal to 50",
      });

      return;
    }

    if (
      new BigNumber(parsedAmount).isLessThan(minValue) &&
      (metadata?.totalUserStaked as BigNumber).toString() == "0"
    ) {
      stakeForm.setError("amount", {
        type: "min",
        message: "Amount must be greater than or equal to 50",
      });

      return;
    }

    if (new BigNumber(parsedAmount).isGreaterThan(maxValue)) {
      stakeForm.setError("amount", {
        type: "max",
        message: "Amount must be less than or equal to available balance",
      });

      return;
    }

    const parsedStakeAmount = new BigNumber(amount).multipliedBy(
      new BigNumber(10).pow(12)
    );

    toast.loading("Staking...");

    await web3Enable(INVARCH_WEB3_ENABLE);

    const injector = await web3FromAddress(selectedAccount.address);

    try {
      const toasts: ISignAndSendCallback = {
        onInvalid: () => {
          toast.dismiss();
          toast.error("Invalid transaction");
        },
        onExecuted: () => {
          toast.dismiss();
          toast.loading("Waiting for confirmation...");
        },
        onSuccess: () => {
          toast.dismiss();
          toast.success("Staked successfully");
        },
        onDropped: () => {
          toast.dismiss();
          toast.error("Transaction dropped");
        },
      };

      if (!altBalance) {
        const fromCore = metadata.key;
        const amount = parsedStakeAmount.toString();

        await api.tx.ocifStaking
          .stake(fromCore, amount)
          .signAndSend(
            selectedAccount.address,
            { signer: injector.signer },
            getSignAndSendCallbackWithPromise(toasts)
          );
      } else {
        const toCore = metadata.key;
        const fromCore = selectedCoreInfo?.id;
        const amount = parsedStakeAmount.toString();

        await api.tx.ocifStaking
          .moveStake(fromCore, amount, toCore)
          .signAndSend(
            selectedAccount.address,
            { signer: injector.signer },
            getSignAndSendCallbackWithPromise(toasts)
          );
      }
    } catch (error) {
      toast.dismiss();
      toast.error(`${ error }`);
    } finally {
      closeCurrentModal();
    }
  });

  const handleUnstake = unstakeForm.handleSubmit(async ({ amount }) => {
    if (!selectedAccount) return;

    if (!metadata) throw new Error(NO_METADATA_ERROR);

    const parsedAmount = parseFloat(amount);

    const maxValue = new BigNumber(metadata.totalUserStaked as string)
      .dividedBy(new BigNumber(10).pow(12))
      .toString();

    if (parsedAmount <= 0) {
      unstakeForm.setError("amount", {
        type: "min",
        message: "Amount must be greater than 0",
      });

      return;
    }

    if (new BigNumber(parsedAmount).isGreaterThan(maxValue)) {
      unstakeForm.setError("amount", {
        type: "max",
        message: "Amount must be less than or equal to total staked",
      });

      return;
    }

    const parsedUnstakeAmount = new BigNumber(parsedAmount).multipliedBy(
      new BigNumber(10).pow(12)
    );

    toast.loading("Unstaking...");

    await web3Enable(INVARCH_WEB3_ENABLE);

    const injector = await web3FromAddress(selectedAccount.address);

    try {
      await api.tx.ocifStaking
        .unstake(metadata.key, parsedUnstakeAmount.toString())
        .signAndSend(
          selectedAccount.address,
          { signer: injector.signer },
          getSignAndSendCallbackWithPromise({
            onInvalid: () => {
              toast.dismiss();
              toast.error("Invalid transaction");
            },
            onExecuted: () => {
              toast.dismiss();
              toast.loading("Waiting for confirmation...");
            },
            onSuccess: () => {
              toast.dismiss();
              toast.success("Unstaked successfully");
            },
            onDropped: () => {
              toast.dismiss();
              toast.error("Transaction dropped");
            },
          })
        );
    } catch (error) {
      toast.dismiss();
      toast.error("Failed to unstake");
    } finally {
      closeCurrentModal();
    }
  });

  const handleStakeMax = () => {
    if (!metadata) throw new Error(NO_METADATA_ERROR);

    const availableBalance = new BigNumber(metadata.availableBalance as string)
      .dividedBy(new BigNumber(10).pow(12));

    let balance = altBalance ? coreStakedBalance : availableBalance.toString();
    // Remove commas before performing the subtraction
    balance = balance.replace(/,/g, '');

    // Subtract 1 VARCH to cover fees if balance is greater than 1
    const balanceToStake = new BigNumber(balance).gte(new BigNumber(1))
      ? new BigNumber(balance).minus(new BigNumber(1)).toString()
      : balance;

    stakeForm.setValue(
      "amount",
      balanceToStake
    );

    stakeForm.trigger("amount", {
      shouldFocus: true,
    });
  };

  const handleUnstakeMax = () => {
    if (!metadata) throw new Error(NO_METADATA_ERROR);

    const totalUserStaked = new BigNumber(metadata.totalUserStaked as string)
      .dividedBy(new BigNumber(10).pow(12));

    let balance = totalUserStaked.toString();
    // Remove commas before performing the subtraction
    balance = balance.replace(/,/g, '');

    // Subtract 1 VARCH to cover fees if balance is greater than 1
    const balanceToUnstake = new BigNumber(balance).gt(1)
      ? new BigNumber(balance).minus(1).toString()
      : balance;

    unstakeForm.setValue(
      "amount",
      balanceToUnstake
    );

    unstakeForm.trigger("amount", {
      shouldFocus: true,
    });
  };

  const handleTabChange = (index: number) => {
    if (index === 0) {
      stakeForm.reset();
      return;
    }

    unstakeForm.reset();
  };

  const handleSelect = (selected: { name: string; } | null) => {
    if (selected) {
      const selectCore = stakingCores.find(core => core.metadata.name === selected.name);
      if (selectCore) {
        setSelectedCore(selectCore);
      }
    }
  };

  const getTabClassNames = useCallback((selected: boolean) => {
    return classNames(
      "w-full rounded-md py-2.5 text-sm font-medium leading-5 focus:outline-none shadow-lg",
      selected
        ? "bg-invarchOffBlack/30 text-invarchPink border border-px cursor-not-allowed border-invarchPink/100"
        : "border border-px border-invarchCream/20 text-invarchCream/20 hover:text-invarchPink hover:text-opacity-100 bg-invarchPink/10 hover:border-invarchPink/100 hover:underline underline-offset-2"
    );
  }, []);

  useEffect(() => {
    initialSelectedCore.current = metadata;
  }, [metadata]);

  useEffect(() => {
    if (!metadata) return;
    if ('stakingCores' in metadata) {
      setStakingCores(metadata.stakingCores as StakingCore[]);
    }
    if ('totalUserStakedData' in metadata) {
      setTotalUserStakedData(metadata.totalUserStakedData as TotalUserStakedData);
    }
  }, [metadata]);

  useEffect(() => {
    stakeForm.reset();
    unstakeForm.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metadata?.key]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedCore(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (selectedCoreInfo && initialCore && selectedCoreInfo?.name !== initialCore?.name) {
      isAltBalance(true);

      if (selectedCoreInfo?.userStaked) {
        const stakedBalance = formatBalance(selectedCoreInfo?.userStaked?.toString(), {
          decimals: 12,
          withUnit: false,
          forceUnit: "-",
        }).slice(0, -2) || "0";
        setCoreStakedBalance(stakedBalance);
      }
      return;
    }

    isAltBalance(false);
    setCoreStakedBalance("0");
  }, [selectedCoreInfo, initialCore, metadata]);

  useEffect(() => {
    if (altBalance) {
      const currentAmount = parseFloat(stakeForm.getValues('amount'));
      const maxBalance = parseFloat(coreStakedBalance);
      if (currentAmount > maxBalance) {
        stakeForm.setValue('amount', maxBalance.toString().replace(/,/g, ''));
      }
    }
  }, [altBalance, coreStakedBalance, stakeForm]);

  const RestakingDropdown = memo(() => {
    const list = stakingCores
      .map(core => ({ id: core.key, userStaked: totalUserStakedData[core.key], name: core.metadata.name }) as SelectedCoreInfo)
      .filter(core => core.userStaked && core.userStaked.gt(new BigNumber(0)));

    if (!list || list.length === 0) return null;

    return <Dropdown initialValue={(initialSelectedCore.current?.metadata as SelectedCoreInfo)?.name as string} currentValue={selectedCoreInfo} list={list} onSelect={handleSelect} />;
  });

  // Watch for changes in stakeForm.amount
  useEffect(() => {
    const value = stakeForm.getValues('amount');
    if (value && !/^[0-9]*\.?[0-9]*$/.test(value)) {
      stakeForm.setValue('amount', value.replace(/[^0-9.]/g, ''));
    }
  }, [stakeForm, watchedStakeAmount]);

  // Watch for changes in unstakeForm.amount
  useEffect(() => {
    const value = unstakeForm.getValues('amount');
    if (value && !/^[0-9]*\.?[0-9]*$/.test(value)) {
      unstakeForm.setValue('amount', value.replace(/[^0-9.]/g, ''));
    }
  }, [unstakeForm, watchedUnstakeAmount]);

  return isOpen ? (
    <Dialog open={true} onClose={closeCurrentModal}>
      <Dialog.Title className="sr-only">Manage Staking</Dialog.Title>
      <div className="fixed inset-0 z-[49] h-screen w-full bg-invarchOffBlack/10 backdrop-blur-md" />
      <button className="pointer fixed top-0 right-0 z-50 flex cursor-pointer flex-col items-center justify-center p-3 text-gray-100 outline-none duration-500 hover:bg-opacity-100 hover:opacity-50">
        <XMarkIcon className="h-5 w-5" />
      </button>
      <Dialog.Panel>
        <>
          <div className={MODAL_STYLE}>
            <h2 className="text-md font-bold text-invarchCream w-[calc(100%-2rem)] max-w-lg truncate">Manage Staking for {(initialSelectedCore.current?.metadata as { name: string; })?.name}</h2>

            <div className="flex flex-col justify-between gap-4">
              <div className="flex flex-row justify-around gap-4 sm:flex-auto mb-4">
                <div className="text-sm text-invarchCream text-center">
                  <div className="font-bold">
                    {formatBalance(
                      metadata?.availableBalance
                        ? metadata.availableBalance.toString()
                        : "0",
                      {
                        decimals: 12,
                        withUnit: false,
                        forceUnit: "-",
                      }
                    ).slice(0, -2) || "0"}{" "}
                    {`${ TOKEN_SYMBOL }`}
                  </div>
                  <div className="text-xxs/none">Available Balance</div>
                </div>

                {metadata?.totalUserStaked &&
                  metadata?.totalUserStaked.toString() !== "0" ? (
                  <div className="text-sm text-invarchCream text-center">
                    <div className="font-bold">
                      {formatBalance(metadata?.totalUserStaked?.toString(), {
                        decimals: 12,
                        withUnit: false,
                        forceUnit: "-",
                      }).slice(0, -2) || "0"} {`${ TOKEN_SYMBOL }`}
                    </div>
                    <div className="text-xxs/none">Currently Staked</div>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-col gap-4">
                <Tab.Group onChange={handleTabChange}>
                  {metadata?.totalUserStaked &&
                    metadata?.totalUserStaked.toString() !== "0" ? (
                    <Tab.List className="flex gap-3 space-x-1 rounded-md">
                      <Tab
                        key={mode.STAKE}
                        className={({ selected }) =>
                          getTabClassNames(selected)
                        }
                      >
                        Stake More/Restake
                      </Tab>
                      <Tab
                        key={mode.UNSTAKE}
                        className={({ selected }) =>
                          getTabClassNames(selected)
                        }
                      >
                        Stake Less
                      </Tab>
                    </Tab.List>
                  ) : null}

                  <Tab.Panels>
                    <Tab.Panel
                      key={mode.STAKE}
                      className={classNames(
                        "flex flex-col gap-4 rounded-md",
                        "focus:outline-none"
                      )}
                    >
                      <form
                        className="flex flex-col items-between gap-4"
                        onSubmit={handleStake}
                      >
                        <div className="flex flex-col md:flex-row gap-4 items-between justify-center">
                          <div className="flex-grow">
                            <div className="block text-xxs font-medium text-invarchCream mb-1">Transfer Funds From</div>
                            <RestakingDropdown />
                          </div>
                          <div className="flex-grow">
                            <label
                              htmlFor="stakeAmount"
                              className="block text-xxs font-medium text-invarchCream mb-1"
                            >
                              <span>Stake Amount</span>
                              {altBalance ?
                                <span className="float-right">
                                  Balance: <span className="font-bold">{coreStakedBalance}</span> {`${ TOKEN_SYMBOL }`}
                                </span> : null}
                            </label>
                            <div className="relative flex flex-row items-center">
                              <Input {...stakeForm.register("amount", {
                                required: true,
                              })} type="text" id="stakeAmount" />
                              <div className="absolute inset-y-0 right-0 flex flex-row items-center gap-4 transform -translate-x-1/2">
                                <span
                                  className="block cursor-pointer text-invarchCream hover:text- text-xs focus:outline-none"
                                  onClick={handleStakeMax}
                                  tabIndex={0}
                                >
                                  MAX
                                </span>
                              </div>
                            </div>
                            {stakeForm.formState.errors.amount ? (
                              <p className="text-xs text-red-400 mt-1">{stakeForm.formState.errors.amount.message}
                              </p>
                            ) : null}
                          </div>
                        </div>

                        <Button mini variant="primary" type="submit" disabled={!stakeForm.formState.isValid}>
                          {altBalance ? 'Restake' : 'Stake'} {watchedStakeAmount} {`${ TOKEN_SYMBOL }`}
                        </Button>
                      </form>
                    </Tab.Panel>
                    <Tab.Panel
                      key={mode.UNSTAKE}
                      className={classNames(
                        "rounded-md",
                        "focus:outline-none"
                      )}
                    >
                      <form
                        className="flex flex-col items-between gap-4"
                        onSubmit={handleUnstake}
                      >
                        <div>
                          <label
                            htmlFor="stakeAmount"
                            className="block text-xxs font-medium text-invarchCream mb-1"
                          >Unstake Amount</label>
                          <div className="relative flex flex-row items-center">
                            <Input {...unstakeForm.register("amount", {
                              required: true,
                            })} type="text" id="unstakeAmount" />
                            <div className="absolute inset-y-0 right-0 flex flex-row items-center gap-4 transform -translate-x-1/2">
                              <span
                                className="block cursor-pointer text-invarchCream hover:text- text-xs focus:outline-none hover:underline underline-offset-2"
                                onClick={handleUnstakeMax}
                                tabIndex={0}
                              >
                                MAX
                              </span>
                            </div>
                          </div>
                          {unstakeForm.formState.errors.amount ? (
                            <p className="text-xs text-red-400 mt-1">{unstakeForm.formState.errors.amount.message}
                            </p>
                          ) : null}
                        </div>

                        <Button mini variant="primary" type="submit" disabled={!unstakeForm.formState.isValid}>
                          Unstake {watchedUnstakeAmount} {`${ TOKEN_SYMBOL }`}
                        </Button>
                        <p className="text-xxs text-center text-invarchCream">NOTE: Unstaking {`${ TOKEN_SYMBOL }`} will have an unbonding period of 28 days.</p>
                      </form>
                    </Tab.Panel>
                  </Tab.Panels>
                </Tab.Group>
              </div>
            </div>
          </div>
        </>
      </Dialog.Panel>
    </Dialog >
  ) : null;
};

export default ManageStaking;
