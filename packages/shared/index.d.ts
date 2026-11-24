import { Rating, State, type Card as FSRSCard, createEmptyCard } from "ts-fsrs";
export declare const fsrsEngine: import("ts-fsrs").FSRS;
export { Rating, State, type FSRSCard, createEmptyCard };
export declare function normalizeCategory(value: string | undefined): string;
export declare const FSRS_RATINGS: {
    readonly again: Rating.Again;
    readonly hard: Rating.Hard;
    readonly good: Rating.Good;
    readonly easy: Rating.Easy;
};
export type FsrsRatingName = keyof typeof FSRS_RATINGS;
export type FsrsReviewRating = Rating.Again | Rating.Hard | Rating.Good | Rating.Easy;
export interface FsrsUpdate {
    due: Date;
    state: State;
    stability: number;
    difficulty: number;
    elapsed_days: number;
    scheduled_days: number;
    learning_steps: number;
    reps: number;
    lapses: number;
    last_review: Date | undefined;
}
export declare function buildFsrsUpdate(card: FSRSCard, rating: FsrsReviewRating, now: Date): FsrsUpdate;
