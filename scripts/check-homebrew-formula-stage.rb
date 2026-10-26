# Check Formula#install against the archive root Homebrew uses as buildpath.
require "tmpdir"
require "pathname"
require "shellwords"
class StageLibrary
  def install(*paths)
    paths.each do |path|
      raise "missing staged input: #{path}" unless File.exist?(path)
    end
  end

  def /(path)
    Pathname.new(path)
  end
end

class StageBin
  def /(path)
    raise "unexpected command: #{path}" unless path == "herdr-world"
    self
  end
  def write(content)
    raise "missing conditional bootstrap" unless content.include?("herdr status") && content.include?('ln "$staging/herdr" "$install_dir/"')
  end
  def chmod(_mode); end
end

class Formula
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
# Herdr keeps its existing owner; World must not force a Homebrew installation.
raise "Herdr must not be a mandatory dependency" unless formula_class.dependencies.empty?
Dir.mktmpdir("herdr-world-homebrew-stage-") do |stage|
  system("tar", "-xJf", archive, "-C", stage, "--strip-components=1", exception: true)
  Dir.chdir(stage) { formula_class.new.install }
end
puts "Formula install inputs found in staged archive"
