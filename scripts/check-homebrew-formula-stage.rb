# Check Formula#install against the archive root Homebrew uses as buildpath.
require "tmpdir"
require "pathname"
require "rubygems/version"
Version = Gem::Version

# Archive staging checks World files, with a synthetic admitted dependency.
module Utils
  def self.safe_popen_read(binary, option)
    raise "unexpected dependency probe" unless binary.to_s == "/fixture/herdr/bin/herdr" && option == "--version"
    "herdr 999.0.0\n"
  end
end

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

# Herdr is a separate Homebrew dependency; the World keg must not export it.
module OS
  def self.mac? = false
end

module Hardware
  module CPU
    def self.intel? = false
  end
end

class Formula
  def self.[](name)
    raise "unexpected dependency" unless name == "herdr"
    Struct.new(:opt_bin).new(Pathname.new("/fixture/herdr/bin"))
  end
  def odie(message) = raise(message)
  def self.inherited(child) = child.instance_variable_set(:@dependencies, [])
  def self.depends_on(name) = @dependencies << name
  def self.dependencies = @dependencies
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
formula_class = Object.const_get(class_name)
raise "Herdr must keep its separate Homebrew owner" unless formula_class.dependencies == ["herdr"]
Dir.mktmpdir("herdr-world-homebrew-stage-") do |stage|
  system("tar", "-xJf", archive, "-C", stage, "--strip-components=1", exception: true)
  Dir.chdir(stage) { formula_class.new.install }
end
puts "Formula install inputs found in staged archive"
