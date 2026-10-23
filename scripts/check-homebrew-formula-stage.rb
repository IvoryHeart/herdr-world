# Check Formula#install against the archive root Homebrew uses as buildpath.
require "tmpdir"

class StageLibrary
  def install(*paths)
    paths.each do |path|
      raise "missing staged input: #{path}" unless File.exist?(path)
    end
  end

  def /(path)
    path
  end
end

class StageBin
  def install_symlink(path)
    raise "unexpected link: #{path}" unless path == "herdr-world"
  end
end

# The staged archive is the World package; the Intel Mac Herdr resource is
# checked by its pinned URL and digest in generate-homebrew-formula.test.ts.
module OS
  def self.mac? = false
end

module Hardware
  module CPU
    def self.intel? = false
  end
end

class Formula
  def self.test(&_block); end
  def self.method_missing(_name, *_args, &_block); end
  def self.respond_to_missing?(_name, _include_private = false) = true
  def libexec = StageLibrary.new
  def bin = StageBin.new
end

formula_arg, archive_arg, class_name = ARGV
formula = File.expand_path(formula_arg)
archive = File.expand_path(archive_arg)
load formula
Dir.mktmpdir("herdr-world-homebrew-stage-") do |stage|
  system("tar", "-xJf", archive, "-C", stage, "--strip-components=1", exception: true)
  Dir.chdir(stage) { Object.const_get(class_name).new.install }
end
puts "Formula install inputs found in staged archive"
