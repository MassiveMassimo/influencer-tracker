"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type ChartPhase, type ChartStatus, resolveRestingChartPhase } from "./chart-phase";

export interface UseChartPhaseOrchestratorOptions {
  chartStatus: ChartStatus;
  targetData: Record<string, unknown>[];
  skeletonData: Record<string, unknown>[];
  animationDuration: number;
  yDomainTweenDuration: number;
  /** Signature of motion URL state — replays clip reveal in Studio. */
  revealSignature?: string;
  /** Skip mount/signature enter reveal (static docs previews). */
  skipEnterReveal?: boolean;
}

export function useChartPhaseOrchestrator({
  chartStatus,
  targetData,
  skeletonData,
  animationDuration,
  yDomainTweenDuration,
  revealSignature = "",
  skipEnterReveal = false,
}: UseChartPhaseOrchestratorOptions) {
  // Start a ready chart already in `revealing` so the first painted frame is the
  // clip-at-0 entrance, not the resting full state. Triggering the reveal from a
  // post-paint effect (see below) let one frame of the fully-drawn chart paint
  // first — a flash of the whole graph that then vanished and swept back in,
  // worst in dev where commits are slow. Static previews skip the reveal.
  const [chartPhase, setChartPhase] = useState<ChartPhase>(() =>
    chartStatus === "ready" && !skipEnterReveal
      ? "revealing"
      : resolveRestingChartPhase(chartStatus),
  );
  const [plotData, setPlotData] = useState<Record<string, unknown>[]>(() =>
    chartStatus === "loading" ? skeletonData : targetData,
  );
  const [revealEpoch, setRevealEpoch] = useState(0);
  const [concealEpoch, setConcealEpoch] = useState(0);
  // Not loaded until the enter reveal settles (interaction is gated on isLoaded);
  // only a reveal-skipping ready chart is interactive immediately.
  const [isLoaded, setIsLoaded] = useState(() => chartStatus === "ready" && skipEnterReveal);
  const prevStatusRef = useRef(chartStatus);
  const phaseRef = useRef(chartPhase);
  phaseRef.current = chartPhase;

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: status transition branches for animation durations
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    if (prevStatus === chartStatus) {
      return;
    }
    prevStatusRef.current = chartStatus;

    if (chartStatus === "ready" && prevStatus === "loading") {
      setIsLoaded(false);
      if (animationDuration <= 0) {
        if (yDomainTweenDuration <= 0) {
          setPlotData(targetData);
          setChartPhase("revealing");
        } else {
          setChartPhase("gridTweenReady");
        }
      } else {
        setChartPhase("exiting");
      }
      return;
    }

    if (chartStatus === "loading" && prevStatus === "ready") {
      setIsLoaded(false);
      if (animationDuration <= 0) {
        if (yDomainTweenDuration <= 0) {
          setPlotData(skeletonData);
          setChartPhase("loading");
        } else {
          setChartPhase("gridTweenLoading");
        }
      } else {
        setConcealEpoch((epoch) => epoch + 1);
        setChartPhase("exitingReady");
      }
    }
  }, [animationDuration, chartStatus, skeletonData, targetData, yDomainTweenDuration]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: revealSignature replays enter
  useEffect(() => {
    if (skipEnterReveal) {
      return;
    }
    if (chartStatus !== "ready") {
      return;
    }
    if (phaseRef.current !== "ready") {
      return;
    }

    setChartPhase("revealing");
    setIsLoaded(false);
  }, [animationDuration, chartStatus, revealSignature, skipEnterReveal]);

  useEffect(() => {
    switch (chartPhase) {
      case "loading":
        if (chartStatus === "loading") {
          setPlotData(skeletonData);
        }
        break;
      case "exiting":
        setPlotData(skeletonData);
        break;
      case "exitingReady":
      case "gridTweenLoading":
      case "gridTweenReady":
      case "revealing":
      case "ready":
        setPlotData(targetData);
        break;
      default:
        break;
    }
  }, [chartPhase, chartStatus, skeletonData, targetData]);

  /** Loading pulse exit finished — tween grid to ready spacing next. */
  const notifyLoadingPulseComplete = useCallback(() => {
    if (phaseRef.current !== "exiting") {
      return;
    }
    setChartPhase("gridTweenReady");
  }, []);

  /** Ready series conceal finished — tween grid to loading spacing next. */
  const notifyRevealConcealComplete = useCallback(() => {
    if (phaseRef.current !== "exitingReady") {
      return;
    }
    setChartPhase("gridTweenLoading");
  }, []);

  /** Grid tween finished — enter the next resting phase. */
  const notifyYDomainTweenComplete = useCallback(() => {
    if (phaseRef.current === "gridTweenLoading") {
      setChartPhase("loading");
      return;
    }
    if (phaseRef.current === "gridTweenReady") {
      setChartPhase("revealing");
    }
  }, []);

  useEffect(() => {
    if (chartPhase !== "revealing") {
      return;
    }

    setRevealEpoch((epoch) => epoch + 1);
    if (animationDuration <= 0) {
      setChartPhase("ready");
      setIsLoaded(true);
      return;
    }

    const timer = window.setTimeout(() => {
      setChartPhase("ready");
      setIsLoaded(true);
    }, animationDuration);
    return () => window.clearTimeout(timer);
  }, [animationDuration, chartPhase]);

  return {
    chartPhase,
    plotData,
    revealEpoch,
    concealEpoch,
    isLoaded,
    notifyLoadingPulseComplete,
    notifyRevealConcealComplete,
    notifyYDomainTweenComplete,
  };
}
