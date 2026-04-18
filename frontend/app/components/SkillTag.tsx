interface SkillTagProps {
  skill: string;
  highlight?: boolean;
}

export default function SkillTag({ skill, highlight }: SkillTagProps) {
  return (
    <span
      className={
        highlight
          ? "inline-block px-2 py-0.5 rounded text-xs font-medium bg-al-accent text-al-bg"
          : "inline-block px-2 py-0.5 rounded text-xs font-medium bg-al-accent/10 text-al-accent border border-al-accent/20"
      }
    >
      {skill}
    </span>
  );
}
