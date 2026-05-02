import React from "react";
import Link from "next/link";

interface LessonsProps {
  learningCount?: number;
  reviewingCount?: number;
  masteredCount?: number;
}

interface BucketProps {
  label: string;
  count: number;
  color: string;
}

function Bucket({ label, count, color }: BucketProps) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`text-3xl font-bold leading-none ${color}`}>
        {count.toLocaleString()}
      </span>
      <span className="text-xs font-medium uppercase tracking-wide text-[#6b7079]">
        {label}
      </span>
    </div>
  );
}

export default function Lessons({
  learningCount = 0,
  reviewingCount = 0,
  masteredCount = 0,
}: LessonsProps) {
  return (
    <div className="flex items-center justify-center p-4 font-sans h-full">
      <div className="w-full max-w-lg">
        <Link
          href="/learn"
          className="group relative flex w-full cursor-pointer flex-col overflow-hidden rounded-2xl border border-[#cad0d6] bg-[#e8ecf0] p-6 transition-all duration-200 hover:border-[#9ea5ac] hover:shadow-md active:scale-[0.99] active:border-[#cad0d6] active:shadow-sm"
        >
          <div className="flex flex-wrap items-center gap-4 sm:flex-nowrap">
            <div className="flex shrink-0 basis-[100px] items-center justify-center">
              <img
                src="/shodo.png"
                alt="Lessons"
                className="aspect-square w-full max-w-[100px] object-contain transition-transform duration-300 group-hover:scale-105"
              />
            </div>

            <div className="flex grow flex-col gap-4">
              <div className="text-[20px] font-bold leading-none text-[#333333]">
                Knowledge Units
              </div>

              <div className="flex justify-around gap-4">
                <Bucket
                  label="Pending"
                  count={learningCount}
                  color="text-blue-500"
                />
                <div className="w-px self-stretch bg-[#cad0d6]" />
                <Bucket
                  label="Review"
                  count={reviewingCount}
                  color="text-amber-500"
                />
                <div className="w-px self-stretch bg-[#cad0d6]" />
                <Bucket
                  label="Mastered"
                  count={masteredCount}
                  color="text-green-600"
                />
              </div>
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
